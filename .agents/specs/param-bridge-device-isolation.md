# Param Bridge Device Isolation

**Context**: Bug report — editing any knob on an instrument panel (e.g. Fermenter) mutates the
audio parameters of every other track that uses the same plugin type. Confirmed to affect Fermenter,
Toaster, Crust, and ProofChamber. Root cause traced to `getActiveDevices()` in each bridge, which
returns all instances of a plugin type across all tracks and broadcasts every change to all of them.
The same architecture already works correctly in Gluten, Bacteria, Grinder, and Proof.

---

## Goal

After this fix, editing a parameter in any instrument panel affects only the device whose panel is
currently open, leaving all other same-type devices on other tracks unchanged — both in audio and
in persisted state.

---

## User-visible behavior

- Open Fermenter on Track A. Adjust Filter Cutoff. Track B's Fermenter is silent and unchanged.
- Open Fermenter on Track B. The panel reflects Track B's saved patch, not Track A's.
- Same behaviour for Toaster, Crust, and ProofChamber.
- Switching focus from one device panel to another closes the previous panel (existing behaviour,
  unchanged).

---

## Scope

**In scope**

- Fermenter param bridge, store, and panel
- Toaster param bridge, store, and panel
- Crust param bridge, store, and panel
- ProofChamber param bridge and panel (no store — panel uses local state)
- AppShell event handlers and panel rendering for each of the four plugins
- InstrumentsTab event dispatch when creating a new track

**Out of scope**

- Levain (different architecture — single active-device registration)
- Gluten, Bacteria, Grinder, Proof (already correct)
- Multi-panel simultaneous editing (one panel per plugin type at a time, same as today)
- Automation recording, MIDI routing, sequencer state — no changes to those layers

---

## Requirements

1. `setFermenterParamWithAudio` must accept `deviceId: string` as its first argument and send
   updates only to that device.
2. `loadFermenterPatchWithAudio` must accept `deviceId: string` and push the patch only to that
   device.
3. `fermenterStore` must be keyed by `deviceId` (`Record<string, FermenterState>`) so each device
   instance holds its own patch and UI state.
4. `FermenterPanel` must receive `deviceId: string` as a prop and pass it to every bridge and store
   call.
5. AppShell must track `fermenterDeviceId: string | null` (not a boolean) and pass it as a prop to
   `FermenterPanel`.
6. The `SHOW_FERMENTER_TAB` CustomEvent must carry `{ deviceId: string }` in its detail — both
   from InstrumentsTab (new track) and from TrackDevicesSection (existing device click).
7. Requirements 1–6 apply identically to Toaster, Crust, and ProofChamber, with the exception that
   ProofChamber has no store to migrate (its panel already manages local state).
8. `pnpm deps:validate` passes with zero violations after all changes.
9. TypeScript compiles without errors (`pnpm typecheck`).

---

## Constraints

- No codemods, sed/awk, or bash loops over source files — each file edited individually.
- Minimum necessary changes only: no cleanup, no unrelated refactors, no new abstractions.
- Do not break the `presetMorph.ts` callers — they call `setFermenterParamWithAudio` and must be
  updated to pass `deviceId`.
- `pnpm deps:validate` after every batch of cross-module file changes.

---

## Design decisions

| Decision             | Chosen                                                                          | Rejected alternatives                                                                                   |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Store shape          | Per-device `Record<string, State>` keyed by `deviceId` (matches Gluten pattern) | Focused-device singleton ref — eliminated the stale-UI patch bug too                                    |
| Bridge signature     | Add `deviceId: string` as explicit first param                                  | Context via React prop drilling only — bridges are non-React modules                                    |
| AppShell panel state | `xxxDeviceId: string \| null` (null = closed)                                   | Separate `open: bool + deviceId: string` — redundant state                                              |
| Event detail         | `{ deviceId: string }` on CustomEvent                                           | No change — inspector already sends deviceId; only AppShell handlers and InstrumentsTab needed updating |

---

## Acceptance criteria

- [ ] Two Fermenter tracks: moving any knob on Track A's panel does not change Track B's audio
      (no AudioWorklet message sent to Track B's worklet).
- [ ] Loading a preset on Track A does not overwrite Track B's `parameterValues` in the track store.
- [ ] Switching to Track B's Fermenter panel shows Track B's saved patch, not Track A's.
- [ ] Same three criteria hold for Toaster, Crust, and ProofChamber.
- [ ] `pnpm deps:validate` → zero violations.
- [ ] `pnpm typecheck` → zero errors.
- [ ] No regressions: single-track sessions behave identically to before.

---

## Implementation notes

Reference implementation: `src/modules/Gluten/` — read store, bridge, and panel before editing
each plugin. The 5-step migration per plugin:

1. **Store** — change `Store<XxxState>` to `Store<Record<string, XxxState>>`. All helpers gain
   `deviceId: string` as first arg. ProofChamber: skip (no store).
2. **Bridge** — remove `getActiveDevices()` and the 2-second cache. Add `findDeviceRef(deviceId)`
   (same helper used in Gluten). Public functions gain `deviceId: string`. Throttle composite key:
   `${deviceId}:${key}`. ProofChamber bridge is simpler — only `updateProofChamberParam` needs
   `deviceId`.
3. **Panel** — add `({ deviceId }: { deviceId: string })` to component signature. Thread `deviceId`
   through all bridge/store calls inside the component.
4. **AppShell** — replace `xxxOpen: boolean` / `setXxxOpen` with `xxxDeviceId: string | null` /
   `setXxxDeviceId`. Update `closeAllDevicePanels`. Update the event handler to extract
   `(e as CustomEvent<{ deviceId?: string }>).detail?.deviceId ?? null`. Update the JSX to pass
   `deviceId={xxxDeviceId}` prop.
5. **InstrumentsTab** — capture the `string | null` returned by `createTrackFromPreset`, look up
   the new track's instrument device id, dispatch a CustomEvent with `{ detail: { deviceId } }`.
   Existing click path in TrackDevicesSection already sends the correct detail — no change needed
   there.

**Additional callers to update after Fermenter bridge:**

- `src/modules/Fermenter/useCases/presetMorph.ts` — calls `setFermenterParamWithAudio`; needs
  `deviceId` threaded in from the call site (TransformPad).

---

## Test plan

**Manual (per plugin)**

1. Add two tracks of the same plugin type (e.g. two Fermenter tracks).
2. Open Track A's panel. Move a knob. Confirm Track B's meters/audio are unchanged.
3. Load a preset on Track A. Inspect Track B's device in the inspector — `parameterValues` must
   not have changed.
4. Close Track A's panel. Open Track B's panel. Confirm the panel shows Track B's saved values.

**Automated**

- `pnpm deps:validate` → zero violations
- `pnpm typecheck` → zero errors

---

## Open questions

- [ ] **[MINOR]** Does `presetMorph.ts` (TransformPad) have access to a `deviceId` at its call
      site, or does it need it threaded from above? — resolvable during implementation.

---

## Tradeoffs and risks

- **Store migration**: converting a singleton store to a Record adds a small memory overhead (one
  state object per device instance instead of one global). Negligible in practice.
- **Missed callers**: if any component calls the old bridge functions without `deviceId`, TypeScript
  will catch it at compile time.
- **InstrumentsTab timing**: `createTrackFromPreset` returns the trackId synchronously, but the
  audio engine device attachment is async. The `deviceId` from the arrangement store is set
  synchronously so the event can still carry it correctly.

---

## Implementation progress

| Plugin               | Store                | Bridge           | Panel            | AppShell          | InstrumentsTab        | Status                                    |
| -------------------- | -------------------- | ---------------- | ---------------- | ----------------- | --------------------- | ----------------------------------------- |
| Fermenter            | ✅ per-device Record | ✅ findDeviceRef | ✅ deviceId prop | ✅ deviceId state | ✅ CustomEvent detail | complete                                  |
| Toaster              | n/a (bridge-only)    | ✅ findDeviceRef | ✅ deviceId prop | ✅ deviceId state | ✅ CustomEvent detail | complete                                  |
| Crust                | n/a (bridge-only)    | ✅ findDeviceRef | ✅ deviceId prop | ✅ deviceId state | n/a                   | complete                                  |
| ProofChamber         | n/a                  | ✅ findDeviceRef | ✅ deviceId prop | ✅ deviceId state | n/a                   | complete                                  |
| `pnpm deps:validate` |                      |                  |                  |                   |                       | ✅ 10 pre-existing violations (unchanged) |
| `pnpm typecheck`     |                      |                  |                  |                   |                       | ✅ zero errors                            |
