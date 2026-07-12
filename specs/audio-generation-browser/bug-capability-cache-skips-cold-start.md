---
type: bug
id: BUG-browser-ai-capability-cache-skips-cold-start
title: Browser AI startup can reuse cached capabilities instead of re-probing cold start state
status: fixed
owner: The Sourdaw team
sources:
  - inventory/deep-codebase-risk-audit-2026-06-27.md
  - SPEC-audio-generation-browser
---

# Bug: Browser AI startup can reuse cached capabilities instead of re-probing cold start state

## Symptom

Browser AI startup can report a stale localStorage capability result instead of re-detecting the platform on cold start.

That means a WebView2/WebGPU regression can be masked until a user manually opens the capability panel path that forces refresh.

## Reproduction

1. Confirm the spec requires cold-start detection:

```text
specs/audio-generation-browser/spec.md:229:### AC-025 — Capability detection re-runs on every cold start with provenance
specs/audio-generation-browser/spec.md:231:Capability detection must run on every cold start (not only first launch) so a WebView2/WebGPU
specs/audio-generation-browser/spec.md:234:Verify with: `pnpm test:run -- BrowserAi capabilityColdStart`
```

2. Confirm startup calls the detector without `forceRefresh`, while the repository returns cached localStorage data first:

```text
/Users/josecosta/dev/sourdaw/src/modules/BrowserAi/useCases/initBrowserAi.ts:67:                const report = await detectCapabilitiesRepo();
/Users/josecosta/dev/sourdaw/src/modules/BrowserAi/repositories/capabilityDetector.ts:96:            forceRefresh = false,
/Users/josecosta/dev/sourdaw/src/modules/BrowserAi/repositories/capabilityDetector.ts:99:            if (!forceRefresh && typeof localStorage !== 'undefined') {
/Users/josecosta/dev/sourdaw/src/modules/BrowserAi/repositories/capabilityDetector.ts:104:                        logger.info('[BrowserAi] Using cached capability report');
```

3. Confirm there is no current `capabilityColdStart` test in the BrowserAi module:

```text
/Users/josecosta/dev/sourdaw/src/modules/BrowserAi/repositories/__tests__/modelDownloadManager.spec.ts
/Users/josecosta/dev/sourdaw/src/modules/BrowserAi/repositories/__tests__/storageManager.spec.ts
/Users/josecosta/dev/sourdaw/src/modules/BrowserAi/services/__tests__/audioResampler.spec.ts
/Users/josecosta/dev/sourdaw/src/modules/BrowserAi/services/__tests__/kokoroTokenizer.spec.ts
/Users/josecosta/dev/sourdaw/src/modules/BrowserAi/services/__tests__/midiToDdspInput.spec.ts
/Users/josecosta/dev/sourdaw/src/modules/BrowserAi/useCases/__tests__/renderDiffSingerPhrase.cachedSessions.spec.ts
```

**Expected:** `initBrowserAi` re-probes capabilities on each cold start, or otherwise bypasses the cache for the cold-start path required by `AC-025`.
**Actual:** `initBrowserAi` takes the default detector path, whose default is `forceRefresh = false`; cached localStorage data returns before any probe runs.
**Conditions:** Reproduced by source inspection on 2026-06-27 from the local `sourdaw` working tree.

## Root cause

`src/modules/BrowserAi/useCases/initBrowserAi.ts:67` calls `detectCapabilitiesRepo()` with no arguments. `src/modules/BrowserAi/repositories/capabilityDetector.ts:96-105` defaults `forceRefresh` to `false`, checks `window.localStorage`, parses the cached report, logs `Using cached capability report`, and returns it before reaching the browser/WebGPU probes.

## Affected requirements

- `SPEC-audio-generation-browser#AC-025` - cold-start capability detection is explicitly required to re-run, not use only the first-launch result.
- `SPEC-audio-generation-browser#AC-030` - render provenance can inherit stale capability values when startup does not refresh the capability report.
