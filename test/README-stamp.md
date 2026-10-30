# Seal browser regression tests

Serve the repository root with a static HTTP server, install Playwright in a test environment, then run:

```sh
TEST_BASE_URL=http://127.0.0.1:8765 node test/stamp.browser.cjs
```

Optional environment variables: `PLAYWRIGHT_MODULE` (path to a Playwright package), `CHROMIUM_PATH` (existing browser executable). No runtime dependency or project build configuration is changed.

The suite exercises 2–4 Hangul/Hanja names, mixed scripts, all shapes, short/long circular company names, Korean/Chinese titles, independent fonts/layouts, PNG aspect ratio and alpha, pixel equality with the preview SVG, 1024/4096px rendering, an actual downloaded PNG's RGBA header, deterministic optional texture, background modes, missing-glyph protection, reset, local reference upload/analysis, mobile overflow, signature tabs and other-page smoke checks. It does not replace end-to-end tests of unrelated tools or physical printer calibration.
