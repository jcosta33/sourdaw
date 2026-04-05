# Audit: Faust AudioWorklet Compilation and Registration Errors

## Metadata

- **Type:** Bug Audit & Fix Specification
- **Context:** `AudioWorklet` processor registration, Faust DSP compilation, Web Audio API.

---

## The Issues

The console logs reveal two distinct, critical errors occurring during the DAW's Web Audio engine initialization and playback, specifically impacting Faust-based devices.

### 1. Faust Compilation Failure (`undefined symbol: lf_freq`)

**Error:** `[Faust] Compilation failed for "Pro Parametric EQ": Pro_Parametric_EQ:3 : ERROR : undefined symbol : lf_freq`
**Stack Trace:**

- `compileFaustDSP` @ `compilerEngine.ts:126`
- `createFaustDevice` @ `faustDeviceFactory.ts:32`
- `createFaustDeviceNode` @ `deviceResolvers.ts:15`
- `addDevice` @ `TrackNode.ts:262`

**Analysis:**
The Faust DSP code for the `Pro Parametric EQ` contains a syntax or reference error. It is trying to use a variable or UI element named `lf_freq` (likely intended for Low Frequency) that has not been defined or imported in the `.dsp` source string. Because the DSP fails to compile, the Faust device node cannot be created, breaking the track's audio graph.

### 2. AudioWorkletProcessor Registration Conflicts (`NotSupportedError`)

**Error:** `NotSupportedError: Failed to execute 'registerProcessor' on 'AudioWorkletGlobalScope': An AudioWorkletProcessor with name:"<hash>" is already registered.`
**Stack Trace:**

- `(anonymous)` @ `AudioWorkletGlobalScope` (generated URL)
- Triggered dynamically when adding devices to strips (e.g., `addDeviceToStrip`).

**Analysis:**
When the DAW instantiates multiple identical Faust devices (or other custom Web Audio Worklets), it is attempting to call `registerProcessor('name', class)` multiple times for the exact same processor name. The Web Audio API strictly forbids registering the same processor name twice within a single `AudioContext`'s `AudioWorkletGlobalScope`.

---

## Investigation Checklist for the Agent

To fix these issues, the agent must perform the following investigations and edits.

### Task 1: Fix the Faust DSP Compilation Error

1. **Locate the DSP Source:** Search the codebase for `Pro Parametric EQ` or the specific `.dsp` code that defines it. (Check `src/modules/Plugin/repositories/faust/` or `src/modules/Plugin/useCases/faustEngine.ts`).
2. **Identify the Typo:** Find where `lf_freq` is referenced. It is likely a typo for a standard Faust library function, or a missing UI declaration like `vslider("lf_freq", ...)`.
3. **Fix the DSP:** Correct the Faust code so it compiles cleanly. (e.g., if it's meant to be `hslider("LF Freq", ...)` ensure the variable binding matches).

### Task 2: Fix the AudioWorklet Registration Conflict

1. **Locate `registerProcessor` Logic:** Search for `registerProcessor` or `addModule` inside the Faust factory or Audio Engine repositories (e.g., `compilerEngine.ts`, `faustDeviceFactory.ts`).
2. **Implement a Registration Registry:**
    - The engine must maintain a `Set<string>` or `Map<string, Promise<void>>` tracking which processor names (or Faust DSP hashes) have already been loaded into the `AudioWorklet`.
    - Before calling `audioContext.audioWorklet.addModule(url)`, the code must check if the hash/name is already in the registry.
    - If it is already registered (or currently compiling/loading), the function should return immediately or await the existing Promise, rather than attempting to inject and register the processor script again.
3. **Handle Faust `faustwasm` specifics:** If using the official `faustwasm` library, check its `FaustCompiler.compileNode` or `FaustMonoDspGenerator` methods. Ensure the factory caches the `Generator` or the compiled WASM module so it doesn't re-add the worklet script for every new instance of the EQ.

---

## Acceptance Criteria

- [ ] The "Pro Parametric EQ" loads without throwing `undefined symbol: lf_freq`.
- [ ] Adding multiple instances of the same Faust plugin (e.g., to two different tracks) does not throw `NotSupportedError: ... is already registered`.
- [ ] The `AudioWorklet` registry correctly deduplicates `addModule` calls for identical processor hashes.
