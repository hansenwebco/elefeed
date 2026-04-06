# Quick Start Guide

## Run Tests in 30 Seconds

### 1. Start a local server

```bash
# Terminal in your elefeed directory
python3 -m http.server 8080
```

### 2. Open your browser

```
http://localhost:8080/tests/
```

### 3. Check the console

Press **F12** to open Developer Tools and look at the **Console** tab. Tests run automatically!

---

## What You'll See

✓ **Green checkmarks** = Test passed  
✗ **Red X's** = Test failed  

The test console button in the bottom-right corner shows test results.

---

## Next Steps

- **Read more**: Open [TEST-README.md](TEST-README.md) for detailed documentation
- **Write tests**: Edit `test-scenarios.js` to add more tests
- **Mock data**: Modify `mock-api.js` to test different scenarios

---

## Common Issues

**"fetch is not a function"**
- Make sure you're using HTTP, not `file://`
- Ensure your server is running

**No test output**
- Check Browser Console (F12)
- Reload the page
- Make sure JavaScript is enabled

**Tests seem stuck**
- Waiters have 5-second timeouts — long waits will appear stuck
- Check console for specific error messages

---

## Key Features

✅ **No posting/deleting** — Mock API blocks all mutations  
✅ **No dependencies** — Pure JavaScript, no npm required  
✅ **Self-contained** — All test code in `/tests` directory  
✅ **Credentials safe** — `.testenv` is git-ignored  
✅ **Easy to extend** — Simple test framework, add your own tests  

---

Happy testing! 🐘
