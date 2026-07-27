# Mycelium Ascendant — launch and dependency integrity

Evidence refreshed: 2026-07-27 05:47 CEST
Project fingerprint: `ba393156719bbefa59aba850d760326099fdbff48ac4a6c294043af1a3bd85e7`
Source receipt: capture HEAD `2a22f163f41d9e7b3a4a6399ea0ecffc7bb5bcd9`; tracked-source tree `388d645ea5a4be6b502ec7fb6da7c5332e799b797d1f9b2202fe8075d5db0bab` (8,845 files; generated evidence excluded); receipt `a1b6a4abefa422a7c6184f3939571c66c2096b7755f86fbca33f247f32cda08a`

## Browser launch

`launchFlows.spec.ts` launches Mycelium Ascendant from a clean browser workspace, verifies the project title, Kick, Main Vision, Temple Chamber, and Sporefall section, reloads the page, and verifies the same project surfaces again. The offline export and stem E2Es additionally reject console errors, page errors, failed requests, external requests, and HTTP errors.

## Desktop-runtime contract launch

`myceliumDesktopRuntime.spec.ts` launches the same demo with the Tauri v2 webview contract active: `window.__TAURI_INTERNALS__` is present and legacy `window.__TAURI__` is absent, matching `withGlobalTauri: false`. Its strict invoke mock rejects every command except `list_midi_inputs`, and the test asserts that exact single call plus the title, three representative tracks, Sporefall, and zero unexpected console/page/network failures. The exact run summary is `desktop-runtime-evidence.json`; `mycelium-desktop-runtime-log` is a local Playwright attachment.

This is a desktop-runtime contract simulation in Chromium, not a native-shell/WebDriver run. The repository has no Tauri WebDriver harness, and a fresh native build was intentionally not introduced while the workspace had only 19 GiB free; the evidence does not claim native window automation.

**AC-020 status: partial / unsupported for native desktop launch.** Browser launch and the webview contract simulation pass; a native Tauri-shell launch has not been verified.

## Bundled-only dependency proof

The deterministic blueprint has 119 MIDI clips, no audio clips, no `audioBuffers`, no `bufferId`, `audioBufferId`, or `assetHash`, and no Crumbs device. Its 59 devices are built-in Sourdaw instruments/effects. Launch, reload, stem, and stereo-export E2Es require no external network request, file, sample, plugin, microphone, or MIDI device.

Reproduction:

```sh
node_modules/.bin/playwright test tests/e2e/launchFlows.spec.ts -g "Mycelium Ascendant" --config=tests/e2e/playwright.mycelium.config.cjs
node scripts/capture-mycelium-evidence.mjs desktop
```
