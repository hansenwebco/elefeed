# Elefeed Test Suite

A production-focused test suite that **validates your real app code** without modifying it or creating stubs.

## ⚡ Key Design

- ✅ Tests validate **REAL production code** (not stubs or mocks)
- ✅ **Fails if production code is deleted/missing** (catches broken deployments)
- ✅ Mock API blocks all destructive operations (safe)
- ✅ Zero dependencies, zero modifications to app code
- ✅ Runs on any HTTP server

## Getting Started (Pick One)

### 1️⃣ **I want to run tests NOW** 
→ Open [QUICKSTART.md](QUICKSTART.md) (5 minutes)

### 2️⃣ **I want to understand the design**
→ Read [IMPLEMENTATION.md](IMPLEMENTATION.md) (10 minutes)

### 3️⃣ **I want detailed documentation**
→ Read [TEST-README.md](TEST-README.md) (20 minutes)

### 4️⃣ **I want to write tests**
→ Edit [test-scenarios.js](test-scenarios.js) and use examples from TEST-README.md

---

## Test Suite Files

| File | Purpose | Modified? |
|------|---------|-----------|
| `index.html` | Test page entry point | No - don't edit |
| `test-runner.js` | Assertion framework | No - don't edit |
| `test-scenarios.js` | **Your tests go here** | **Yes - add tests** |
| `mock-api.js` | Mock Mastodon API | Rarely - extend for custom endpoints |
| `.testenv.example` | Template for credentials | Rename to `.testenv` if using live server |
| `TEST-README.md` | Complete documentation | No - reference only |
| `QUICKSTART.md` | Quick reference | No - reference only |
| `IMPLEMENTATION.md` | Technical overview | No - reference only |

---

## Quick Reference

### Run tests
```bash
python3 -m http.server 8080
# Then open: http://localhost:8080/tests/
```

### Write a test
```javascript
runner.describe('My Feature', (suite) => {
  suite.test('does something', async (t) => {
    // Your test code
  });
});
```

### Available assertions
- `t.assert(actual, expected)`
- `t.assertElementExists(selector)`
- `t.assertElementVisible(selector)`
- `t.assertHasClass(selector, className)`
- `t.assertElementContains(selector, text)`
- `await t.waitForElement(selector)`
- `await t.waitForCondition(fn)`

---

## Key Points

✅ **No dependencies** - Pure JavaScript  
✅ **No data loss** - POST/DELETE/PATCH blocked  
✅ **Isolated** - Separate `/tests` directory  
✅ **Credentials safe** - `.testenv` git-ignored  
✅ **Mock data** - Realistic Mastodon API responses  

---

## What's Protected

This test suite ensures:

- No posts are created during testing
- No posts are deleted during testing  
- No data is modified during testing
- No boosts, favorites, or interactions happen
- Credentials are never committed to git
- Tests can't break your app's state

---

## Next Steps

1. **Read QUICKSTART.md** (pick your guide above)
2. **Run the tests** (`python3 -m http.server 8080`)
3. **Open http://localhost:8080/tests/**
4. **Check browser console (F12)**
5. **Add your own tests to test-scenarios.js**

---

Enjoy your test suite! 🐘
