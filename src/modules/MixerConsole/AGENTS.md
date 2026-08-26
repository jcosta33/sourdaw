# MixerConsole module — Agent Guidelines

Owns presentation components, layout views, and interaction hooks for the multi-track mixing console UI (`MixerPanel`); does not own track/device domain state (Arrangement), audio summing or DSP routing (AudioEngine), or peak/RMS meter data generation (Metering).

## Public Contract Surface

- `presentations/views/`: `MixerPanel`.
- `stores/`, `useCases/`, `events/`: No public domain stores, use cases, or events exported (pure presentation module).
- Handlers: None (dispatches actions via Command bus).

## Key Subsystems

- **Mixer Panel Container:** `MixerPanel` mounts into the Workspace AppShell, coordinating track channel strips, scrolling, and master bus layouts.
- **Channel Strip Components:** `ExpandedChannelStrip`, `MasterChannelStrip`, `IOSection`, `DeviceChainSection`, `MidiFxSection`, `SendsSection`, `MixerLevelReadout`, `MixerPopupMenu`.
- **Interaction Hooks:** `useChannelStripActions` (dispatches fader, pan, mute, solo gestures to Command handlers), `useTracks` (reads reactive trackStore and effective audibility), `useWorkspaceState`.
- **Mix Health Diagnostics:** `MixHealthDialog` computes headroom, clipping warnings, and bus hierarchy integrity.

## Invariants & Traps

- **Strict Presentation Isolation:** Never mutate `trackStore` directly from mixer UI components; all user actions must dispatch through Command actions.
- **Meter Decoupling:** Level meters consume animation-frame streams from `Metering`, never querying AudioWorklets or blocking the main thread.
- **Master Bus Rules:** The master channel strip enforces dedicated master routing without sends or hardware input selectors.

## Verification

```bash
pnpm vitest run src/modules/MixerConsole
pnpm deps:validate
```
