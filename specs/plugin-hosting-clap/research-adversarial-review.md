---
type: research
id: RESEARCH-plugin-hosting-clap-adversarial-review
title: Device-lifecycle safety of the unified plugin-host controller
status: open
owner: The Sourdaw team
sources:
  - Adversarial review of the unified DeviceController device-lifecycle path
---

# Research: Device-lifecycle safety of the unified plugin-host controller

## Question

When `TrackNode` delegates plugin operations through a unified `DeviceController`
(`dn.controller`), does the device lifecycle — parameter changes, bypass, removal,
and disposal — clean up native DSP resources and reactive store state safely, or
does it leak/crash?

## Findings

### R-001 — Per-device store entries are not deleted on teardown

- **Claim:** `toasterStore` and `levainStore` hold per-device state in a
  `Record<string, State>`, but removing a device or disposing a track never
  deletes the `deviceId` key, leaking store entries.
- **Evidence:** `TrackNode.ts:431` calls `unregisterLevainDevice(dn.deviceId)`,
  which in `helpers.ts` only clears local Maps (`activeDevices`, `activePorts`)
  and never calls `levainStore.set(...)` to delete the key; for Toaster no
  unregister hook is called at all.
- **Confidence:** high
- **Bears on:** the device-removal/dispose contract and store teardown
  requirements.

### R-002 — Missing `destroy` on native DSP controllers can crash the audio path

- **Claim:** Native DSP plugins (Gluten, Bacteria, Grinder, …) are given a
  controller without a `destroy` function, while `removeDevice` calls
  `dn.controller.destroy()` unconditionally — invoking an `undefined` method and
  throwing `TypeError`, which interrupts Web Audio processing.
- **Evidence:** `wasmDeviceRegistry.ts` builds controllers as
  `{ setParam, setBypass } as any`; `TrackNode.ts` `removeDevice` runs
  `if (dn.controller) { dn.controller.destroy(); }` — truthy controller, absent
  `destroy`.
- **Confidence:** high
- **Bears on:** whether disposal must use optional invocation
  (`dn.controller.destroy?.()`) and whether the controller type must require
  `destroy`.

### R-003 — `as any` controllers defeat the type check

- **Claim:** Defining controllers with `as any` (14 occurrences) suppresses the
  compiler's shape check, so a missing `destroy` is not caught by `pnpm
  typecheck` — a green typecheck does not prove the lifecycle is safe.
- **Evidence:** `wasmDeviceRegistry.ts` — 14 `as any` controller definitions.
- **Confidence:** high
- **Bears on:** the soundness requirement for the controller contract (concrete
  type instead of `as any`).

## Open questions

- [ ] Q-001 — Does current code still construct any controller without a
  `destroy` hook, or invoke `destroy()` non-optionally? Re-running the device
  removal/dispose path against the present `TrackNode.ts` and
  `wasmDeviceRegistry.ts` would confirm whether R-001/R-002 still reproduce.
- [ ] Q-002 — Are there other per-device reactive stores (beyond Toaster/Levain)
  with the same key-deletion gap on teardown?

## Recommendation

A spec built on the unified controller should treat the device lifecycle as the
load-bearing contract: require a concrete `DeviceController` type (no `as any`)
with an explicit `destroy`, invoke disposal defensively
(`dn.controller.destroy?.()`), and require per-device store keys to be deleted on
`removeDevice`/`dispose`. Type-check alone is insufficient evidence (R-003); the
removal/dispose path needs an executed teardown test.
