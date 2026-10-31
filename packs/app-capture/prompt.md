Use the `shipcast:app-capture` skill to capture real product UI from the running app.

- The app details are in the "Run your app" step's `out/app.json` (path listed below under earlier steps).
- Capture tool: `node {{plugin}}/skills/app-capture/scripts/capture.mjs plan.json` — write your plans to `./work/`.
