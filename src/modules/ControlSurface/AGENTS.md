# ControlSurface module — Agent Guidelines

Hardware controller integration: manages MIDI controller surface mapping profiles, MIDI Learn bindings, and Ableton Push 1/2 hardware protocol drivers.

## Domain Ownership

Owns hardware MIDI controller integrations, controller surface profiles, MIDI Learn parameter bindings, Push 1/2 hardware protocols (display rendering, button/encoder codecs, USB/MIDI transport), and hardware state mapping. Does not own Web MIDI device port discovery or sequencer playback routing (MIDI module), or device parameter state (Arrangement / AudioEngine).

## Public Contract Surface

- **`useCases`**: `completeMidiLearn`, `handleMidiMessage`, `getMidiLearnState`, `setMidiLearnDependencies`, `exportHardwareMappings`, `importHardwareMappings`, `matchControllerProfile`, `getControlSurfaceHandlers`.
- **`stores`**: `midiLearnStore`.
- **`presentations/views`**: `MidiLearnButton`, `MidiLearnRotaryKnob`.
- **`events`**: None.
- **Handler maps**: `getControlSurfaceHandlers` (`handleSetControlSurface`, `handleClearAllMappings`, `handleRestoreMidiLearnMappings`, `handleConnectPush`, `handleDisconnectPush`).

## Key Subsystems

- **`repositories/`**: Push hardware communication protocol stack (`pushDisplayProtocol.ts`, `pushHardwareTransport.ts`, `pushMidiCodec.ts`).
- **`stores/`**: `controlSurface.ts`, `hardwareControllerStore.ts`, `midiLearnStore.ts`, `push.ts`.
- **`models/`**: `ControllerMappingSchema.ts`, `ControllerProfile.ts` (factory definitions for Push, APC40, Launchpad, KeyLab, custom controllers).
- **`presentations/views/`**: MIDI learn UI binding components (`MidiLearnButton.tsx`, `MidiLearnRotaryKnob.tsx`).
- **`handlers/`**: Production command handlers for MIDI learn, controller selection, and Push hardware connect/disconnect.

## Invariants & Traps

- **DI Seam for parameter writes**: `setMidiLearnDependencies` in `src/app/bootstrap.ts` connects parameter update use cases to MIDI Learn dispatch without creating circular module dependencies.
- **Mapping schema validation**: Hardware mapping export and import must validate against `ControllerMappingSchema` with schema versioning to prevent corrupt controller bindings.
- **Push display protocol backpressure**: Push display frame rendering over USB bulk/MIDI endpoints requires packet framing and rate limiting to avoid dropped frames or main-thread rendering lag.
- **Intercepted MIDI isolation**: Hardware messages captured by active MIDI Learn bindings mutate targeted parameters directly and must not be forwarded into track recording MIDI streams.

## Verification

- **Focused unit tests**: `pnpm test:run src/modules/ControlSurface`
- **Module boundaries**: `pnpm deps:validate`
