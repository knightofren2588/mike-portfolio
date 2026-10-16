# Command Center tests (Stark AI frontend)

These are plain Node tests. They use Node's built-in test runner, add no dependencies, open no browser and make **no network
requests** (every call to the server is a fake function inside the test).

Run them from the repository root:

    node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test command-center/tests/*.test.mjs

Needs Node 22.7 or newer (the same Node you use for the backend tests).

`contract.test.mjs` also compares this frontend with the Stark AI backend source. It looks for a sibling folder named
`stark-tech-backend` (or the folder in the `STARK_BACKEND_DIR` environment variable) and quietly skips itself if it is not there.

`static-safety.test.mjs` includes a deliberate tripwire: it fails if `STARK_AI.enabled` is true. When you decide to switch Stark
AI on, update that one test in the same change.
