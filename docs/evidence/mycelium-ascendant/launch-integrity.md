# Mycelium Ascendant — launch and dependency integrity

Historical evidence refreshed: 2026-07-26 18:05 CEST
Project fingerprint: `1cea829dfa15f1e3ac94e611606cc3ef2ac3c4a2bccdfe1cc5707412565ffd9c`

> Historical only: the canonical score has since changed. Current launch and dependency acceptance require a fresh run against the reconstructed blueprint.

## Browser launch

`launchFlows.spec.ts` launches Mycelium Ascendant from a clean browser workspace, verifies the project title, Kick, Main Vision, Temple Chamber, and Sporefall section, reloads the page, and verifies the same project surfaces again. The offline export and stem E2Es additionally reject console errors, page errors, failed requests, external requests, and HTTP errors.

## Desktop-runtime contract launch

`myceliumDesktopRuntime.spec.ts` launches the same demo with the Tauri v2 webview contract active: `window.__TAURI_INTERNALS__` is present and legacy `window.__TAURI__` is absent, matching `withGlobalTauri: false`. Its strict invoke mock rejects every command except `list_midi_inputs`, and the test asserts that exact single call plus the title, three representative tracks, Sporefall, and zero unexpected console/page/network failures. The exact run summary is `desktop-runtime-evidence.json`; `mycelium-desktop-runtime-log` is a local Playwright attachment.

This is a desktop-runtime contract simulation in Chromium, not a native-shell/WebDriver run. The repository has no Tauri WebDriver harness, and a fresh native build was intentionally not introduced while the workspace had only 19 GiB free; the evidence does not claim native window automation.

**Historical AC-020 result:** browser launch and the webview contract simulation passed for the captured blueprint; a current run and native Tauri-shell launch remain unverified.

## Bundled-only dependency proof

The deterministic blueprint has 118 MIDI clips, no audio clips, no `audioBuffers`, no `bufferId`, `audioBufferId`, or `assetHash`, and no Crumbs device. Its 59 devices are built-in Sourdaw instruments/effects. Launch, reload, stem, and stereo-export E2Es require no external network request, file, sample, plugin, microphone, or MIDI device.

Reproduction:

```sh
node_modules/.bin/playwright test tests/e2e/launchFlows.spec.ts -g "Mycelium Ascendant" --config=tests/e2e/playwright.mycelium.config.cjs
node_modules/.bin/playwright test tests/e2e/myceliumDesktopRuntime.spec.ts --config=tests/e2e/playwright.mycelium.config.cjs
```
