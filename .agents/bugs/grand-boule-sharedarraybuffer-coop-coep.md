# Bug: Grand Boule fails to initialize — SharedArrayBuffer not available (COOP/COEP headers missing)

## Status

**Open**

## Symptoms (DevTools console)

```
[WebAudioEngine] Grand Boule failed: Error: SharedArrayBuffer is not available. The server must send Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp headers.
```

The Grand Boule piano instrument fails to load with the above error. The WASM device descriptor catches this in `wasmDeviceRegistry.ts` at line 482.

## What this means

`SharedArrayBuffer` (SAB) is required by the Grand Boule architecture for zero-copy ring buffer communication between:
- The **Web Worker** running the WASM physical-modeling piano engine
- The **AudioWorkletProcessor** consuming rendered audio frames

SAB is only available in cross-origin isolated contexts. This requires the document to be served with two HTTP headers:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Without these headers, `typeof SharedArrayBuffer === 'undefined'` and `GrandBouleNode.ts` throws at line 89-94 before initialization can proceed.

## Root cause

The **Vite dev server** (`vite.config.ts`) is correctly configured with these headers for development and preview:
- `server.headers` — includes COOP/COEP
- `preview.headers` — includes COOP/CEP

However, the **Tauri runtime** does not apply these headers to the WebView context. Tauri v2 requires explicit header configuration in `tauri.conf.json` under `app.security.headers`, which is currently **missing**:

```json
// Current tauri.conf.json (missing security.headers)
{
    "app": {
        "security": {
            "csp": null,
            // No "headers" section — COOP/COEP not set
        }
    }
}
```

Additionally, Tauri documentation suggests that COOP/COEP headers may need to be set via:
1. The `tauri.conf.json` `app.security.headers` configuration
2. Potentially platform-specific WebView configuration in Rust
3. The `coi-serviceworker` package for development scenarios where headers are not configurable

## Impact

| Feature | Status | Notes |
|---------|--------|-------|
| Grand Boule piano | **Broken** | Cannot initialize — SAB required for Worker↔Worklet ring buffer |
| Other WASM instruments | Varies | May work if they don't require SAB |
| Dev server (Vite) | Works | Headers configured correctly |
| Tauri production build | Broken | Headers not configured in tauri.conf.json |

## Suggested fix

### Option 1: Configure headers in tauri.conf.json (Recommended)

Add the required headers to `src-tauri/tauri.conf.json`:

```json
{
    "app": {
        "security": {
            "csp": null,
            "headers": {
                "Cross-Origin-Opener-Policy": "same-origin",
                "Cross-Origin-Embedder-Policy": "require-corp"
            }
        }
    }
}
```

### Option 2: Use coi-serviceworker as fallback

If Tauri configuration doesn't apply headers correctly to the WebView, use the `coi-serviceworker` package to inject headers via service worker (development scenario):

```bash
pnpm add coi-serviceworker
```

Then import and enable in the app entry point:

```typescript
import { coi } from 'coi-serviceworker';
coi.enable();
```

### Option 3: Platform-specific Rust configuration

If the JSON configuration is insufficient, the headers may need to be set in `src-tauri/src/lib.rs` via the WebView builder:

```rust
tauri::Builder::default()
    // ... existing configuration
    .setup(|app| {
        let window = app.get_webview_window("main").unwrap();
        // Platform-specific header injection if needed
        Ok(())
    })
```

## Verification (after fix)

1. Open DevTools console in Tauri app
2. Verify `window.crossOriginIsolated` returns `true`
3. Verify `typeof SharedArrayBuffer` returns `"function"`
4. Load Grand Boule instrument — should reach "ready" state without error
5. Play MIDI notes — audio should output correctly

## References

- `src/modules/AudioEngine/engine/GrandBouleNode.ts` — lines 88-94: SAB check and error
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts` — line 482: error catch
- `vite.config.ts` — lines 18-19, 74-75: correctly configured dev/preview headers
- `src-tauri/tauri.conf.json` — missing `app.security.headers` configuration
- `.agents/research/pending/plugins-hosting-research.md` — line 57: "Tauri COOP/COEP headers are missing in tauri.conf.json"
- `.agents/specs/global/full-spec.md` — lines 983, 1115, 2026: COOP/COEP requirements for SharedArrayBuffer
- Tauri v2 documentation: `app.security.headers` configuration for cross-origin isolation
