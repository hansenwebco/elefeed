/**
 * @module test-runner
 * Simple test runner for Elefeed — logs test results without external dependencies
 */

class TestRunner {
  constructor() {
    this.suites = []; // Array to track suites
    this.tests = [];
    this.results = {
      passed: 0,
      failed: 0,
      errors: [],
      bySuite: {}, // Results grouped by suite
    };
    this.currentTest = null;
    this.currentSuite = null;
  }

  /**
   * Register a test to run
   */
  test(name, fn) {
    this.tests.push({ name, fn, suite: this.currentSuite });
  }

  /**
   * Register a test suite (grouped tests)
   */
  describe(suiteName, fn) {
    const originalTestCount = this.tests.length;
    
    // Create a scoped API for this describe block
    const scopedAPI = {
      test: (name, testFn) => {
        this.tests.push({
          name: `${suiteName} › ${name}`,
          fn: testFn,
          suite: suiteName,
          displayName: name
        });
      }
    };
    
    // Call the function with the scoped API
    fn(scopedAPI);
    
    // Track this suite
    const newTestCount = this.tests.length;
    if (newTestCount > originalTestCount) {
      this.suites.push({
        name: suiteName,
        testCount: newTestCount - originalTestCount,
        startIndex: originalTestCount
      });
    }
  }

  /**
   * Assert a condition is true
   */
  assert(actual, expected, message = '') {
    if (actual !== expected) {
      throw new Error(
        `Assertion failed${message ? ': ' + message : ''}\n` +
        `  Expected: ${JSON.stringify(expected)}\n` +
        `  Actual: ${JSON.stringify(actual)}`
      );
    }
  }

  /**
   * Assert an element exists
   */
  assertElementExists(selector, message = '') {
    const el = document.querySelector(selector);
    if (!el) {
      throw new Error(`Element not found: ${selector}${message ? ' (' + message + ')' : ''}`);
    }
    return el;
  }

  /**
   * Assert an element is visible
   */
  assertElementVisible(selector, message = '') {
    const el = this.assertElementExists(selector);
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      throw new Error(`Element not visible: ${selector}${message ? ' (' + message + ')' : ''}`);
    }
    return el;
  }

  /**
   * Assert an element has a class
   */
  assertHasClass(selector, className, message = '') {
    const el = this.assertElementExists(selector);
    if (!el.classList.contains(className)) {
      throw new Error(`Element missing class "${className}": ${selector}${message ? ' (' + message + ')' : ''}`);
    }
    return el;
  }

  /**
   * Assert element contains text
   */
  assertElementContains(selector, text, message = '') {
    const el = this.assertElementExists(selector);
    if (!el.textContent.includes(text)) {
      throw new Error(`Element text not found\n  Selector: ${selector}\n  Expected to contain: ${text}\n  Actual: ${el.textContent}${message ? '\n  ' + message : ''}`);
    }
    return el;
  }

  /**
   * Wait for an element to appear
   */
  async waitForElement(selector, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Timeout waiting for element: ${selector}`);
  }

  /**
   * Wait for a condition to be true
   */
  async waitForCondition(fn, timeout = 5000, message = '') {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      try {
        if (fn()) return true;
      } catch {
        // Keep trying
      }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Timeout: condition not met${message ? ' (' + message + ')' : ''}`);
  }

  /**
   * Run all tests
   */
  async run() {
    if (this.tests.length === 0) {
      console.log('%cNo tests defined', 'color: #f97316; font-weight: bold;');
      this.updateScreenStatus('No tests defined', 'failed');
      return true;
    }

    // Initialize stats display
    this.updateStats();
    this.updateProgress();

    console.log(`Running ${this.tests.length} tests...\n`);
    this.updateScreenStatus(`Running ${this.tests.length} tests...`, 'running');

    for (const test of this.tests) {
      this.currentTest = test.name;
      try {
        // Create test context with all assertion methods bound
        const testContext = {
          assert: (actual, expected, msg) => this.assert(actual, expected, msg),
          assertElementExists: (sel, msg) => this.assertElementExists(sel, msg),
          assertElementVisible: (sel, msg) => this.assertElementVisible(sel, msg),
          assertHasClass: (sel, cls, msg) => this.assertHasClass(sel, cls, msg),
          assertElementContains: (sel, txt, msg) => this.assertElementContains(sel, txt, msg),
          waitForElement: (sel, tm) => this.waitForElement(sel, tm),
          waitForCondition: (fn, tm, msg) => this.waitForCondition(fn, tm, msg),
        };

        await test.fn(testContext);
        this.results.passed++;
        console.log(`%c✓ ${test.name}`, 'color: #4ade80;');
        this.addResultToScreen(test.name, true);
      } catch (error) {
        this.results.failed++;
        const errorMsg = error.message || JSON.stringify(error);
        this.results.errors.push({
          test: test.name,
          error: errorMsg,
        });
        console.log(`%c✗ ${test.name}`, 'color: #ef4444;');
        console.log(`  %c${errorMsg}`, 'color: #ef4444; font-size: 12px;');
        this.addResultToScreen(test.name, false, errorMsg);
      }
    }

    this.printSummary();
    this.displaySummaryOnScreen();

    const passed = this.results.passed;
    const failed = this.results.failed;
    if (failed === 0) {
      this.updateScreenStatus(`✓ All ${passed} tests passed!`, 'passed');
    } else {
      this.updateScreenStatus(`✗ ${failed}/${passed + failed} failed`, 'failed');
    }

    return this.results.failed === 0;
  }

  /**
   * Print test summary
   */
  printSummary() {
    console.log('\n' + '═'.repeat(50));

    const passed = this.results.passed;
    const failed = this.results.failed;
    const total = passed + failed;

    if (failed === 0) {
      console.log(`%c✓ All ${total} tests passed!`, 'color: #4ade80; font-weight: bold; font-size: 14px;');
    } else {
      console.log(`%c✗ ${failed}/${total} tests failed`, 'color: #ef4444; font-weight: bold; font-size: 14px;');
      if (this.results.errors.length > 0) {
        console.log('\n%cFailed tests:', 'font-weight: bold; color: #f97316;');
        this.results.errors.forEach(err => {
          console.log(`  • ${err.test}`);
        });
      }
    }

    console.log('═'.repeat(50));
  }

  /**
   * Add a result to the on-screen test panel with grouping by suite
   */
  addResultToScreen(name, passed, error = null) {
    const container = document.getElementById('test-results');
    if (!container) return;

    // Update stats
    this.updateStats();
    this.updateProgress();

    // Parse suite and test name from the full name format "Suite › Test"
    const parts = name.split(' › ');
    const suiteName = parts[0];
    const testName = parts[1] || name;

    // Find or create suite container
    let suiteContainer = container.querySelector(`[data-suite="${suiteName}"]`);
    if (!suiteContainer) {
      suiteContainer = document.createElement('div');
      suiteContainer.className = 'test-suite-container';
      suiteContainer.setAttribute('data-suite', suiteName);

      // Create suite header
      const suiteHeader = document.createElement('div');
      suiteHeader.className = 'test-suite-header';
      suiteHeader.innerHTML = `<span class="test-suite-toggle">▼</span> ${suiteName}`;
      suiteHeader.style.cursor = 'pointer';
      suiteHeader.onclick = () => {
        const testsContainer = suiteContainer.querySelector('.test-suite-tests');
        const isVisible = testsContainer.style.display !== 'none';
        testsContainer.style.display = isVisible ? 'none' : 'block';
        const toggle = suiteHeader.querySelector('.test-suite-toggle');
        toggle.style.transform = isVisible ? 'rotate(-90deg)' : 'rotate(0deg)';
      };

      // Create tests container (collapsible)
      const testsContainer = document.createElement('div');
      testsContainer.className = 'test-suite-tests';
      testsContainer.style.display = 'block';

      suiteContainer.appendChild(suiteHeader);
      suiteContainer.appendChild(testsContainer);
      container.appendChild(suiteContainer);
    }

    // Create test result item
    const testsContainer = suiteContainer.querySelector('.test-suite-tests');
    const item = document.createElement('div');
    item.className = `test-result-item ${passed ? 'passed' : 'failed'}`;

    const icon = document.createElement('div');
    icon.className = 'test-result-icon';
    icon.textContent = passed ? '✓' : '✗';

    const text = document.createElement('div');
    text.className = 'test-result-text';
    text.textContent = testName;

    item.appendChild(icon);
    item.appendChild(text);

    if (error && !passed) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'test-result-error';
      errorDiv.textContent = error;
      item.appendChild(errorDiv);
    }

    testsContainer.appendChild(item);
    container.scrollTop = container.scrollHeight;
  }

  /**
   * Update stats display
   */
  updateStats() {
    const totalEl = document.getElementById('test-stat-total');
    const passedEl = document.getElementById('test-stat-passed');
    const failedEl = document.getElementById('test-stat-failed');

    if (totalEl) totalEl.textContent = this.tests.length;
    if (passedEl) passedEl.textContent = this.results.passed;
    if (failedEl) failedEl.textContent = this.results.failed;
  }

  /**
   * Update progress bar
   */
  updateProgress() {
    const total = this.tests.length;
    const completed = this.results.passed + this.results.failed;
    const percentage = total > 0 ? (completed / total) * 100 : 0;

    const progressFill = document.querySelector('.test-progress-fill');
    if (progressFill) {
      progressFill.style.width = `${percentage}%`;
    }
  }

  /**
   * Update the status display
   */
  updateScreenStatus(text, className = '') {
    const status = document.getElementById('test-panel-status');
    if (status) {
      status.textContent = text;
      status.className = className;
    }
  }

  /**
   * Display summary on screen
   */
  displaySummaryOnScreen() {
    const summaryEl = document.getElementById('test-summary');
    if (!summaryEl) return;

    const passed = this.results.passed;
    const failed = this.results.failed;
    const total = passed + failed;

    let summaryText = '';
    let className = '';

    if (failed === 0) {
      summaryText = `✓ All ${total} tests passed!`;
      className = 'all-passed';
    } else {
      summaryText = `✗ ${failed}/${total} tests failed`;
      className = 'has-failures';
    }

    summaryEl.textContent = summaryText;
    summaryEl.className = className;
  }

  /**
   * Clean up before next test suite
   */
  async cleanup() {
    // Clear any open drawers
    document.querySelectorAll('[class*="drawer"]').forEach(d => {
      if (d.classList.contains('open')) {
        d.classList.remove('open');
      }
    });

    // Clear any modals
    document.querySelectorAll('[class*="modal"]').forEach(m => {
      if (m.style.display !== 'none') {
        m.style.display = 'none';
      }
    });

    // Give DOM a moment to settle
    await new Promise(r => setTimeout(r, 100));
  }
}

export const runner = new TestRunner();
