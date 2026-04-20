# Bug Report: Console Errors and Warnings

## 1. TrackNode Creation Failure (InvalidStateError)

**Error:** `Uncaught InvalidStateError: Failed to construct 'AudioWorkletNode': AudioWorkletNode cannot be created: AudioWorklet does not have a valid AudioWorkletGlobalScope. Load a script via audioWorklet.addModule() first.`

**Raw Stack Trace:**

```
Uncaught InvalidStateError: Failed to construct 'AudioWorkletNode': AudioWorkletNode cannot be created: AudioWorklet does not have a valid AudioWorkletGlobalScope. Load a script via audioWorklet.addModule() first.
    at new TrackNode (TrackNode.ts:60:25)
    at AudioEngineImpl.ensureTrackStrip (createWebAudioEngine.ts:170:24)
    at AudioEngineImpl.addDeviceToStrip (createWebAudioEngine.ts:257:14)
    at addDeviceToStrip (addDeviceToStrip.ts:9:17)
    at createGrandBouleTrack (createGrandBouleTrack.ts:39:13)
    at invoker (inject.ts:124:20)
    at _temp10 (InstrumentsTab.tsx:202:25)
    at executeDispatch (react-dom_client.js?v=9018c5f8:9141:5)
    at runWithFiberInDEV (react-dom_client.js?v=9018c5f8:851:66)
    at processDispatchQueue (react-dom_client.js?v=9018c5f8:9167:27)
(anonymous) @ TrackNode.ts:60
ensureTrackStrip @ createWebAudioEngine.ts:170
addDeviceToStrip @ createWebAudioEngine.ts:257
(anonymous) @ addDeviceToStrip.ts:9
(anonymous) @ createGrandBouleTrack.ts:39
(anonymous) @ inject.ts:124
_temp10 @ InstrumentsTab.tsx:202
executeDispatch @ react-dom_client.js?v=9018c5f8:9141
runWithFiberInDEV @ react-dom_client.js?v=9018c5f8:851
processDispatchQueue @ react-dom_client.js?v=9018c5f8:9167
(anonymous) @ react-dom_client.js?v=9018c5f8:9454
batchedUpdates$1 @ react-dom_client.js?v=9018c5f8:2044
dispatchEventForPluginEventSystem @ react-dom_client.js?v=9018c5f8:9240
dispatchEvent @ react-dom_client.js?v=9018c5f8:11319
dispatchDiscreteEvent @ react-dom_client.js?v=9018c5f8:11301
```

**Likely Cause:**
The `TrackNode` is being instantiated synchronously when a track or device is added to the UI, which calls `new AudioWorkletNode(context, 'metering-processor')`. However, the Web Audio engine initializes asynchronously (`createWebAudioEngine.initialize()` calls `context.audioWorklet.addModule(meteringProcessorUrl)`). If the user interacts with the app (e.g., adding a Grand Boule track or loading a preset) before the engine has fully finished initializing (or if initialization failed), the `metering-processor` will not be available in the `AudioWorkletGlobalScope`, causing a fatal crash.

## 2. Staleness Detection Crash (TypeError)

**Error:** `initStalenessDetection.ts:33 Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'status')`

**Raw Stack Traces:**

```
initStalenessDetection.ts:33 Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'status')
    at initStalenessDetection.ts:33:39
    at notify (createStore.ts:22:17)
    at Object.set (createStore.ts:48:13)
    at setTrackStoreState (setTrackStoreState.ts:4:16)
    at createGrandBouleTrack (createGrandBouleTrack.ts:33:13)
    at invoker (inject.ts:124:20)
    at _temp10 (InstrumentsTab.tsx:202:25)
    at executeDispatch (react-dom_client.js?v=9018c5f8:9141:5)
    at runWithFiberInDEV (react-dom_client.js?v=9018c5f8:851:66)
    at processDispatchQueue (react-dom_client.js?v=9018c5f8:9167:27)

initStalenessDetection.ts:33 Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'status')
    at initStalenessDetection.ts:33:39
    at notify (createStore.ts:22:17)
    at Object.set (createStore.ts:48:13)
    at setTrackState (setTrackState.ts:6:16)
    at addTrack (addTrack.ts:18:9)
    at invoker (inject.ts:124:20)
    at createTrackFromPreset (presetLoading.ts:44:19)
    at _temp11 (InstrumentsTab.tsx:220:9)

initStalenessDetection.ts:33 Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'status')
    at initStalenessDetection.ts:33:39
    at notify (createStore.ts:22:17)
    at Object.set (createStore.ts:48:13)
    at updateTrack (updateTrack.ts:10:16)
    at loadPresetToTrack (presetLoading.ts:86:17)
    at invoker (inject.ts:124:20)
    at createTrackFromPreset (presetLoading.ts:48:5)
    at _temp11 (InstrumentsTab.tsx:220:9)

initStalenessDetection.ts:33 Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'status')
    at initStalenessDetection.ts:33:39
    at notify (createStore.ts:22:17)
    at Object.set (createStore.ts:48:13)
    at updateTrack (updateTrack.ts:10:16)
    at addDevice (addDevice.ts:37:5)
    at attachEffectDevice (presetLoading.ts:33:19)
    at loadPresetToTrack (presetLoading.ts:93:21)
    at invoker (inject.ts:124:20)
    at createTrackFromPreset (presetLoading.ts:48:5)
    at _temp11 (InstrumentsTab.tsx:220:9)

(anonymous) @ initStalenessDetection.ts:33
(anonymous) @ createStore.ts:22
(anonymous) @ createStore.ts:48
(anonymous) @ setTrackState.ts:6
(anonymous) @ addTrack.ts:18
(anonymous) @ inject.ts:124
(anonymous) @ presetLoading.ts:44
_temp11 @ InstrumentsTab.tsx:220

initStalenessDetection.ts:33 Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'status')
    at initStalenessDetection.ts:33:39
    at notify (createStore.ts:22:17)
    at Object.set (createStore.ts:48:13)
    at updateTrack (updateTrack.ts:10:16)
    at loadPresetToTrack (presetLoading.ts:86:17)
    at invoker (inject.ts:124:20)
    at createTrackFromPreset (presetLoading.ts:48:5)
    at _temp11 (InstrumentsTab.tsx:220:9)

initStalenessDetection.ts:33 Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'status')
    at initStalenessDetection.ts:33:39
    at notify (createStore.ts:22:17)
    at Object.set (createStore.ts:48:13)
    at updateTrack (updateTrack.ts:10:16)
    at addDevice (addDevice.ts:37:5)
    at attachEffectDevice (presetLoading.ts:33:19)
    at loadPresetToTrack (presetLoading.ts:93:21)
    at invoker (inject.ts:124:20)
    at createTrackFromPreset (presetLoading.ts:48:5)
    at _temp11 (InstrumentsTab.tsx:220:9)

initStalenessDetection.ts:33 Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'status')
    at initStalenessDetection.ts:33:39
    at notify (createStore.ts:22:17)
    at Object.set (createStore.ts:48:13)
    at setTrackState (setTrackState.ts:6:16)
    at addTrack (addTrack.ts:18:9)
    at invoker (inject.ts:124:20)
    at createTrackFromPreset (presetLoading.ts:44:19)
    at _temp13 (InstrumentsTab.tsx:236:25)

initStalenessDetection.ts:33 Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'status')
    at initStalenessDetection.ts:33:39
    at notify (createStore.ts:22:17)
    at Object.set (createStore.ts:48:13)
    at updateTrack (updateTrack.ts:10:16)
    at loadPresetToTrack (presetLoading.ts:86:17)
    at invoker (inject.ts:124:20)
    at createTrackFromPreset (presetLoading.ts:48:5)
    at _temp13 (InstrumentsTab.tsx:236:25)

initStalenessDetection.ts:33 Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'status')
    at initStalenessDetection.ts:33:39
    at notify (createStore.ts:22:17)
    at Object.set (createStore.ts:48:13)
    at updateTrack (updateTrack.ts:10:16)
    at addDevice (addDevice.ts:37:5)
    at attachEffectDevice (presetLoading.ts:33:19)
    at loadPresetToTrack (presetLoading.ts:93:21)
    at invoker (inject.ts:124:20)
    at createTrackFromPreset (presetLoading.ts:48:5)
    at _temp13 (InstrumentsTab.tsx:236:25)
```

**Likely Cause:**
The staleness detection logic assumes every track in `state.tracks` has a fully defined `freezeState` object. While `createTrack` in `Track.ts` sets a default `freezeState: { status: 'unfrozen' }`, tracks that are loaded from older project files, saved presets, or implicitly created tracks (like the master track) may lack this property. Because `initStalenessDetection.ts` does not use optional chaining (`track.freezeState?.status`), it crashes with a `TypeError` when iterating over a track missing this property during state updates.

## 3. Worklet Module Loading Failures (AbortError)

**Raw Warnings and Stack Traces:**

```
[DEV][WARN] [WebAudioEngine] Levain failed: AbortError: Unable to load a worklet's module.

[DEV][WARN] [WebAudioEngine] Fermenter failed: AbortError: Unable to load a worklet's module.
createConsoleWriter.ts:5 [DEV][WARN] [WebAudioEngine] Fermenter failed: AbortError: Unable to load a worklet's module.
(anonymous) @ createConsoleWriter.ts:5
(anonymous) @ createConsoleWriter.ts:11
(anonymous) @ createLogger.ts:21
(anonymous) @ wasmDeviceRegistry.ts:106
Promise.catch
create @ wasmDeviceRegistry.ts:106
(anonymous) @ TrackNode.ts:360
addDeviceToStrip @ createWebAudioEngine.ts:258
(anonymous) @ addDeviceToStrip.ts:9
(anonymous) @ presetLoading.ts:72
(anonymous) @ presetLoading.ts:91
(anonymous) @ inject.ts:124
(anonymous) @ presetLoading.ts:48
_temp8 @ InstrumentsTab.tsx:188
executeDispatch @ react-dom_client.js?v=9018c5f8:9141
runWithFiberInDEV @ react-dom_client.js?v=9018c5f8:851
processDispatchQueue @ react-dom_client.js?v=9018c5f8:9167
(anonymous) @ react-dom_client.js?v=9018c5f8:9454
batchedUpdates$1 @ react-dom_client.js?v=9018c5f8:2044
dispatchEventForPluginEventSystem @ react-dom_client.js?v=9018c5f8:9240
dispatchEvent @ react-dom_client.js?v=9018c5f8:11319
dispatchDiscreteEvent @ react-dom_client.js?v=9018c5f8:11301

6createConsoleWriter.ts:5 [DEV][WARN] [WebAudioEngine] Fermenter failed: AbortError: Unable to load a worklet's module.
(anonymous) @ createConsoleWriter.ts:5
(anonymous) @ createConsoleWriter.ts:11
(anonymous) @ createLogger.ts:21
(anonymous) @ wasmDeviceRegistry.ts:106
Promise.catch
create @ wasmDeviceRegistry.ts:106
(anonymous) @ TrackNode.ts:360
addDeviceToStrip @ createWebAudioEngine.ts:258
(anonymous) @ addDeviceToStrip.ts:9
(anonymous) @ ensureTrackStrips.ts:44
(anonymous) @ createSweetDreamsDemo.ts:1273

createConsoleWriter.ts:5 [DEV][WARN] [WebAudioEngine] Toaster failed: AbortError: Unable to load a worklet's module.
```

## 4. Production Build Unresolved Import Error
**Error:** `[UNRESOLVED_IMPORT] Error: Could not resolve '../wasm/workletPolyfill.js' in src/modules/AudioEngine/services/glutenProcessor.ts`

**Likely Cause:**
The `glutenProcessor.ts` file has an import statement: `import '../wasm/workletPolyfill.js';`. However, this file either does not exist in the project, is not generated properly before the build step, or is excluded from the module resolution path used by Vite/Rollup during the production build. This breaks the build process for the Gluten processor.
