# The Skeptic's Adversarial Review: Plugin Host Contract

## Date: 2026-04-20

## Author: The Skeptic

I reviewed the work of the previous agent for the `refactor-plugin-host-contract` task. The agent claimed that the workspace is "fully verified and clean," relying entirely on `pnpm typecheck` to prove success.

**This code is broken, leaks memory, and will crash the audio thread.**

Here are my findings.

### 1. Memory Leaks in Reactive Stores (N-18 Regression)

The agent migrated `toasterStore` and `levainStore` to a `Record<string, State>` to fix the singleton collision.
**The catch:** When `removeDevice()` is called in `TrackNode.ts`, or when a track is deleted via `dispose()`, the `deviceId` key is **never** deleted from the stores.

- `levainStore.value[deviceId]` leaks.
- `toasterStore.value[deviceId]` leaks.

**Proof:**
`TrackNode.ts:431` calls `unregisterLevainDevice(dn.deviceId)`. In `helpers.ts`, `unregisterLevainDevice` only clears local Maps (`activeDevices` and `activePorts`). It never calls anything like `levainStore.set(state => { delete state[deviceId]; ... })`. For Toaster, there is literally no unregister hook called at all.

### 2. Audio Engine Crash on Device Removal (I-05 / N-30 Regression)

The agent attempted to unify the `DeviceController` interface and updated `wasmDeviceRegistry.ts`. For all native DSP plugins (Gluten, Bacteria, Grinder, etc.), they created a controller like this:

```typescript
controller: { setParam: result.setParam, setBypass: result.setBypass } as any
```

**The catch:** They did not provide a `destroy` function on these controllers.
In `TrackNode.ts`, the agent changed `removeDevice()` to:

```typescript
if (dn.controller) {
    dn.controller.destroy();
}
```

**Proof:**
When a user deletes a track with Gluten or Bacteria, `dn.controller` evaluates to `true`, but `dn.controller.destroy` is `undefined`. It will throw a `TypeError: dn.controller.destroy is not a function`, instantly crashing the Web Audio processing sequence.

### 3. Sloppy Code / Catch-Alls

In `TrackNode.ts`, the agent mashed the `for` loop on the same line as a closing brace:

```typescript
if (dn.type === 'levain') {
    try {
        unregisterLevainDevice(dn.deviceId);
    } catch {}
}
for (const n of dn.nodes) {
    try {
        n.disconnect();
    } catch {}
}
```

Furthermore, the rampant use of `as any` when defining `controller` objects in `wasmDeviceRegistry.ts` (14 occurrences) bypassed the very TypeScript protections they claimed to have satisfied. `pnpm typecheck` didn't catch the missing `destroy` methods because the agent specifically told the compiler to ignore the shape of the controller.

## Conclusion

The refactor achieved its visual goal of unifying the interface but fundamentally broke the device lifecycle. This branch cannot be merged. The agent must return to `TrackNode.ts`, `wasmDeviceRegistry.ts`, and the UI stores to properly clean up state and safely handle optional `destroy` hooks (`dn.controller.destroy?.()`).
