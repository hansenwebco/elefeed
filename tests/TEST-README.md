# Elefeed Test Suite

A self-contained, browser-based test suite for Elefeed that validates functionality without posting, deleting, or modifying any live data.

## Overview

This test suite is designed to:

- **Verify core functionality** — Dialogs, navigation, UI state changes
- **Prevent data loss** — Blocks all POST, PUT, DELETE, and PATCH operations
- **Use mock data** — Returns realistic test data from a mock API
- **Require no dependencies** — No npm packages, just vanilla JavaScript and HTTP
- **Isolate from production code** — Completely separate from your app's source

## Quick Start

### 1. Serve the project locally

Use any simple HTTP server:

```bash
# Using Python 3
python3 -m http.server 8080

# Or using Node if you want
npx http-server -p 8080

# Or any other HTTP server
```

Then navigate to:
```
http://localhost:8080/tests/
```

### 2. Run the tests

The test suite **automatically runs** when you load the page. Open the browser console (F12 or Ctrl+Shift+I) to see results.

Click the **"Test Suite"** button in the bottom-right corner to toggle the test console visibility.

## Architecture

```
tests/
├── index.html              # Test entry point
├── test-runner.js          # Assertion library & test framework
├── test-scenarios.js       # All test cases
├── mock-api.js             # Mock Mastodon API server
├── .testenv.example        # Template for test configuration
└── fixtures/               # (Optional) Test data files
    └── sample-data.json
```

### How It Works

1. **Test Runner** — Simple test framework with assertions (no external dependencies)
2. **Mock API** — Intercepts all `fetch()` calls and returns mock data
3. **Test Scenarios** — Individual test cases using the test runner
4. **Safety** — All POST/DELETE/PATCH requests are blocked with a helpful error message

## Writing Tests

### Basic Test

```javascript
runner.test('My test name', async (t) => {
  // Your test code here
  t.assert(actual, expected, 'optional message');
});
```

### Test Suites

```javascript
runner.describe('Feature name', async (r) => {
  r?.test?.('Test 1', async (t) => { /* ... */ });
  r?.test?.('Test 2', async (t) => { /* ... */ });
});
```

### Available Assertions

```javascript
// Basic assertion
t.assert(actual, expected, 'optional message');

// DOM assertions
t.assertElementExists('#my-id');
t.assertElementVisible('#visible-element');
t.assertHasClass('#my-el', 'active');
t.assertElementContains('#my-el', 'Expected text');

// Async helpers
await t.waitForElement('#delayed-element', 5000);
await t.waitForCondition(() => {
  return document.querySelectorAll('.item').length === 5;
}, 3000, 'items to load');
```

### Example Test

```javascript
runner.describe('Profile Dialog', async (r) => {
  r?.test?.('Opens profile drawer', async (t) => {
    // Load app if needed
    await loadApp();
    
    // Find element
    const profileBtn = t.assertElementExists('[data-action="show-profile"]');
    
    // Trigger action
    profileBtn.click();
    
    // Wait for drawer to appear
    const drawer = await t.waitForElement('#profile-drawer.open');
    
    // Verify state
    t.assertElementVisible('#profile-drawer');
    t.assertElementContains('#profile-name', 'Test User');
  });
});
```

## Test Coverage

Current test coverage includes:

### ✓ Initialization
- App loads without errors
- Mock API intercepts fetch calls

### ✓ Navigation
- Tab buttons present
- Screen elements exist
- Header, footer, main content structure

### ✓ Drawers & Dialogs
- Profile drawer
- Thread drawer
- Notifications drawer
- Settings drawer
- Search drawer
- Compose drawer

### ✓ API Safety
- POST requests blocked
- DELETE requests blocked
- PUT requests blocked
- GET requests allowed and return mock data

### ✓ State Management
- localStorage is accessible

## Using Test Credentials (Optional)

If you want to test against a **real Mastodon instance** (read-only):

### 1. Create a test instance account

Sign up at any Mastodon instance for testing. You can use:
- mastodon.social (large, stable)
- fosstodon.org (FOSS community)
- Any other instance that allows registration

### 2. Generate credentials

1. Login to your test instance
2. Go to Settings > Development > New application
3. Create an app called "Elefeed Test"
4. Copy the access token

### 3. Store credentials securely

**DO NOT commit credentials to the repository!**

Create a `.testenv` file (git-ignored) in the tests directory:

```bash
cp tests/.testenv.example tests/.testenv
```

Edit `tests/.testenv`:

```
TEST_SERVER=fosstodon.org
TEST_TOKEN=your-access-token-here
TEST_USERNAME=yourusername
```

### 4. Load credentials in your tests

In test-scenarios.js, you can now read these values:

```javascript
// Note: This file must be served via HTTP to read .env
// You'll need to use a custom loader or URL params
```

## Safety Guarantees

This test suite provides **hard guarantees** that no data will be posted or deleted:

1. **Mock API blocks all mutations** — POST, PUT, DELETE, PATCH requests throw errors
2. **No token stored in code** — Credentials stored only in `.testenv` (git-ignored)
3. **Read-only by default** — All mock data is read-only
4. **Clear error messages** — If your code tries to post, you'll see `"Test mode: POST requests are blocked"`

## Mock Data

The mock API returns realistic Mastodon API responses for:

- Instance information
- User profiles
- Timelines (home, public, hashtag, local, federated)
- Posts and statuses
- Notifications
- Trends
- Search results
- Bookmarks
- Favorites
- Accounts / contacts

See `mock-api.js` for all mock data generators.

## Extending Tests

### Adding More Scenarios

Edit `tests/test-scenarios.js` and add new tests:

```javascript
runner.describe('My New Feature', async (r) => {
  r?.test?.('does something', async (t) => {
    // your test
  });
});
```

### Adding Mock Data

In `tests/mock-api.js`, add a new generator function:

```javascript
function getMockCustomData() {
  return {
    id: '123',
    name: 'Test Item',
    // ...
  };
}
```

Then use it in the route handler:

```javascript
if (pathname.includes('/api/v1/custom')) {
  return mockResponse(getMockCustomData());
}
```

### Testing with Real Instance

Modify `mock-api.js` to use a real server for specific endpoints:

```javascript
// Pass through to real server
if (pathname.includes('/api/v1/instance')) {
  return originalFetch(resource, init);
}
```

## Troubleshooting

### Tests not running

- Check browser console (F12) for errors
- Ensure you're serving via HTTP (not `file://`)
- Check that `tests/index.html` can load `test-scenarios.js`

### Mock API not working

- Open console and look for `[MOCK API]` log messages
- Verify `fetch` has been replaced: `console.log(window.fetch.toString())`
- Check that `initMockAPI()` is called before app loads

### Elements not found

- Check the actual HTML structure of `index.html`
- Test selectors in browser console: `document.querySelector('...')`
- Element IDs and classes may vary — update selectors in test-scenarios.js

### Performance issues

- Tests run sequentially — expected if you have many
- Mock API responses are instant
- Long timeouts in `waitForElement` can slow things down

## CI/CD Integration

To run tests in CI/CD:

```bash
# 1. Start a local server in background
python3 -m http.server 8080 &
SERVER_PID=$!

# 2. Run tests with a headless browser
# Using Playwright:
npx playwright install
npx playwright test tests/index.html

# Or using Puppeteer:
node -e "
  const puppeteer = require('puppeteer');
  (async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto('http://localhost:8080/tests/');
    // Wait for tests to complete
    await page.waitForFunction(() => {
      const counter = document.querySelector('#test-counter');
      return counter && counter.textContent.includes('/');
    });
    const logs = await page.evaluate(() => document.body.innerText);
    console.log(logs);
    await browser.close();
  })();
"

# 3. Kill server
kill $SERVER_PID
```

## Limitations

- **No headless browser built-in** — Tests run in an actual browser
- **Mock data is static** — Real workflows with changing data may need custom fixtures
- **No visual regression testing** — Only tests functionality, not appearance
- **Single-threaded** — Tests run sequentially, not in parallel

## Contributing

To add more tests:

1. Open `tests/test-scenarios.js`
2. Add a new `runner.describe()` block
3. Write your test using `runner.test()`
4. Use the assertions from `test-runner.js`
5. Test by loading `http://localhost:8080/tests/`
6. Commit the updated `test-scenarios.js`

Don't commit:
- `.testenv` (test credentials)
- `.testenv.local` (local overrides)
- Any generated test data

## Resources

- [Mastodon API Documentation](https://docs.joinmastodon.org/)
- [Elefeed Project](https://github.com/your-repo/elefeed)
- [MDN: Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
- [MDN: localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
