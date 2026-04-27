# Push Integration — Ableton Push 2 Hardware Support

## Goal

The user plugs in an Ableton Push 2 over USB, clicks "Connect Push 2" in the DAW, and the hardware lights up. Pads reflect the project: in Session mode the 8×8 grid shows clips with their track colours; in Note mode the pads play the currently-selected MIDI track's instrument using the chosen scale; in Drum mode the bottom 4×4 plays drums. The Push's 8 encoders control selected-device parameters. The LCD shows track names and parameter values. Changing modes on hardware updates the DAW; changing selection in the DAW updates the Push display. Under the hood it's all MIDI, plus a USB bulk-transfer channel for the LCD framebuffer.

## Current state

The store is thorough and the use-case surface covers the major operations; what is absent is any code that speaks to the Push. No USB, no MIDI I/O binding, no LCD framebuffer, no hardware test.

What exists:

- `src/modules/Plugin/stores/push.ts` — `PushPadMode` (6 modes), `PushPadColor` (RGB 0–127), `PushPad` (index, midiNote, velocity, aftertouch, color), `PushEncoder` (index, value, parameterPath, label), `PushDisplay` (4 lines of text), `PushState` (connected, model, padMode, 64 pads, 8 encoders, scale, tempo, touchStripPosition), `PAD_MODE_COLORS`.
- `src/modules/Plugin/useCases/pushIntegration/` — 10 use-cases: `connectPush`, `disconnectPush`, `setPadMode`, `setPadColor`, `setScale`, `updateDisplay`, `handlePadPress`, `handlePadRelease`, `setEncoderValue`, `mapEncoder`. All pure store mutations; none send anything to hardware.
- `src/modules/Command/models/AppAction.ts` — `{ type: 'connectPush'; payload: { model: 'push2'|'push3' } }`.
- `miscCommands.ts:261-270` — Command Palette entries `connect-push-2` and `connect-push-3`.

What is missing:

- No USB / MIDI access — no bridge to `navigator.requestMIDIAccess()` or `navigator.usb.requestDevice()`.
- No LCD rendering — Push 2 has a 960×160 px colour LCD accessible via USB bulk transfer endpoint 0x01, format 16-bit RGB565. Our `PushDisplay` model is text-only; the real Push 2 display expects a pixel framebuffer.
- No device message parsing — Push 2 sends pad press/release as MIDI note-on/off; encoders as relative CC messages; touch strip as pitch bend.
- No mode/button mapping — the Push has ~40 function buttons (Play, Stop, Record, Session, Note, …) that need mapping to AppActions.
- No output driver — `setPadColor`, `updateDisplay`, `setEncoderValue` mutate state but don't send MIDI back to the device.
- No session clip-launch grid binding — Session mode should reflect `scratchPadSection` / clip states from `Arrangement`.

## Design

### Transport: Web MIDI + Web USB for LCD

Push 2 protocol docs (Ableton, public):

- **MIDI** over USB MIDIClass interface (endpoint 0x02/0x82). Pads and buttons send/receive MIDI. This is Web MIDI API.
- **Display** over a **separate USB bulk endpoint** (0x01), sending framebuffer packets. Requires Web USB API, cannot go through Web MIDI.

Our architecture uses both:

- MIDI I/O via `navigator.requestMIDIAccess({ sysex: true })` (sysex needed for LED RGB).
- Display I/O via `navigator.usb.requestDevice({ filters: [{ vendorId: 0x2982, productId: 0x1967 }] })` → `open()` → `claimInterface(0)` → `transferOut(0x01, buffer)`.

Both surfaces are behind user-granted permissions. On Tauri, equivalent native bindings exist; the abstraction hides the transport.

### Push 2 USB protocol reference

| Surface          | In                                                                            | Out                                      | Encoding                                                                |
| ---------------- | ----------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| Pads             | MIDI Note On/Off, channel 1, notes 36–99                                      | MIDI Note On (colour index) or SysEx RGB | velocity = press velocity                                               |
| Pad aftertouch   | MIDI Poly Pressure                                                            | —                                        | 0–127                                                                   |
| Encoders (8 top) | MIDI CC 71–78, channel 1, **relative** (signed 7-bit, two's-complement quirk) | —                                        | Encoders are endless rotary                                             |
| Tempo encoder    | MIDI CC 14, relative                                                          | —                                        |                                                                         |
| Touch strip      | MIDI Pitch Bend, channel 1                                                    | Pitch Bend (visual indicator)            |                                                                         |
| Function buttons | MIDI CC 3–87 (various), channel 1                                             | CC 3–87                                  | On/Off LED state                                                        |
| LCD              | —                                                                             | USB bulk transfer endpoint 0x01          | Framebuffer: 20 lines × 160 px × 16-bit RGB565, XORed with a fixed mask |

RGB colour for pads: SysEx `F0 47 7F 15 04 00 08 <pad index 0–63> <colorR> <colorG> <colorB> F7` where each colour component is 7-bit.

### Driver layer

New directory `src/modules/PushHardware/` (separate module from `Plugin` to avoid bloating Plugin with hardware code):

```
src/modules/PushHardware/
  models/
    Push2Protocol.ts     // opcodes, LED indices, framebuffer mask
  repositories/
    createPushUsb.ts     // Web USB for LCD
    createPushMidi.ts    // Web MIDI for everything else
  services/
    framebufferRenderer.ts  // text → RGB565 framebuffer
    midiCodec.ts            // relative-encoder decode, sysex build
  useCases/
    driver/
      attachDriver.ts   // wires store → hardware output + hardware → store input
      detachDriver.ts
    render/
      renderSessionMode.ts
      renderNoteMode.ts
      renderDrumMode.ts
    input/
      routePadPress.ts        // based on padMode dispatches triggerScene / noteOn / drumHit
      routeEncoderDelta.ts    // maps encoder CC to selected-device param
      routeButtonPress.ts     // maps function button to AppAction
```

The existing `src/modules/Plugin/useCases/pushIntegration/` use-cases (store mutations) are **unchanged**; they become the "local state" layer. The new driver layer observes the store and pushes state to hardware, and listens to hardware events and calls the existing use-cases.

### Pad colour sync

On `pushStore.pads` change, diff vs. last-rendered colours and send SysEx packets only for changed pads (throttled at 60 Hz). Batching: up to 64 colour changes in a single SysEx message (the protocol supports it).

### LCD rendering

Push 2's LCD has a peculiar XOR mask applied to every pixel pair (swap bit 7 / bit 15 in alternate words — see protocol docs). The `framebufferRenderer` takes logical lines of text/graphics and produces the required 20 KB framebuffer packet.

For v1, the framebuffer content is text-only (4 lines × 68 chars matching `PushDisplay.lines`). The renderer uses a monospace bitmap font shipped with the module. A future v2 can render parameter knobs and meters.

The framebuffer is re-sent on every display change, debounced to 30 Hz.

### Mode mapping

| Mode      | Pad behaviour                                                          | Encoder behaviour                                  |
| --------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| session   | Top-left cell = scene 0, row = scene, col = track. Colour from clip.   | 8 encoders = 8 selected tracks' volume.            |
| note      | Chromatic or scale-quantised pitches (from `rootNote`, `scaleName`).   | 8 encoders = selected device's first 8 parameters. |
| drum      | Bottom 4×4 = 16 drum pads → MIDI notes 36–51; top 4×4 = loop / repeat. | 8 encoders = 8 selected drum pad params.           |
| chromatic | Every semitone, left-to-right, bottom-to-top.                          | Same as `note`.                                    |
| scale     | Scale-only pads.                                                       | Same as `note`.                                    |
| user      | No predefined behaviour — passes raw MIDI.                             | User-mapped via `mapEncoder`.                      |

### Hardware → DAW event routing

```
midi messagein
    │
    ▼
midiCodec.decode  ────────────── 'pad-press' { index, velocity }
                                 │
                                 ▼
                         routePadPress(padMode)
                           │ session → executeAppAction({ type:'triggerScene', payload:{ column } })
                           │ note    → executeAppAction({ type:'playAuditionNote', ... })
                           │ drum    → executeAppAction({ type:'triggerToasterPad', ... })
                           └ user    → emit('pushPadPress') event for custom handlers
```

Existing use-cases already cover these targets. The driver is plumbing.

### DAW → hardware sync

A subscription-based pattern. The driver creates subscribers:

- `trackStore` change → if padMode = session, re-render pad grid colours.
- `transportStore` change → update Play/Stop LEDs.
- `pushStore.display` change → re-render LCD framebuffer.
- `pushStore.pads` change → SysEx colour updates (if the change didn't originate from hardware — cycle detection via a "recently-received" ring buffer).

## API surface

```ts
// src/modules/PushHardware/repositories/createPushMidi.ts
export type PushMidiPort = {
    send: (bytes: Uint8Array) => void;
    sendSysex: (bytes: Uint8Array) => void;
    onMessage: (cb: (bytes: Uint8Array, timestamp: number) => void) => () => void;
    close: () => Promise<void>;
};
export async function createPushMidi(): Promise<Result<PushMidiPort, PushError>>;

// src/modules/PushHardware/repositories/createPushUsb.ts
export type PushUsbDisplay = {
    writeFramebuffer: (fb: Uint8Array /* 20480 bytes */) => Promise<void>;
    close: () => Promise<void>;
};
export async function createPushUsb(): Promise<Result<PushUsbDisplay, PushError>>;

// src/modules/PushHardware/services/framebufferRenderer.ts
export function renderTextFramebuffer(lines: [string, string, string, string]): Uint8Array;

// src/modules/PushHardware/services/midiCodec.ts
export type PushEvent =
    | { kind: 'pad-press'; index: number; velocity: number }
    | { kind: 'pad-release'; index: number }
    | { kind: 'pad-aftertouch'; index: number; pressure: number }
    | { kind: 'encoder-delta'; index: number; delta: number }
    | { kind: 'button-press'; buttonId: number }
    | { kind: 'button-release'; buttonId: number }
    | { kind: 'touch-strip'; position: number /* 0..1 */ };

export function decodeMidi(bytes: Uint8Array): PushEvent | null;
export function encodePadColorSysex(index: number, color: PushPadColor): Uint8Array;
export function encodeBatchPadColorSysex(colors: Array<{ index: number; color: PushPadColor }>): Uint8Array;

// src/modules/PushHardware/useCases/driver/attachDriver.ts
export async function attachDriver(): Promise<Result<void, PushError>>;
export function detachDriver(): void;

// src/modules/PushHardware/useCases/render/renderSessionMode.ts
export function renderSessionMode(): void; // computes colours from trackStore/clipStore and writes to pushStore.pads

// New AppActions
type PushActions =
    | { type: 'connectPush'; payload: { model: 'push2' | 'push3' } } // EXISTS
    | { type: 'disconnectPush'; payload?: undefined }
    | { type: 'setPushPadMode'; payload: { mode: PushPadMode } }
    | { type: 'setPushScale'; payload: { rootNote: number; scaleName: string } }
    | { type: 'mapPushEncoder'; payload: { encoderIndex: number; parameterPath: string | null; label: string } }
    | { type: 'setPushDisplayLine'; payload: { line: number; text: string } };

// Error type
export type PushError =
    | { code: 'DEVICE_NOT_FOUND' }
    | { code: 'PERMISSION_DENIED' }
    | { code: 'USB_UNSUPPORTED' } // Firefox etc.
    | { code: 'MIDI_UNSUPPORTED' }
    | { code: 'ALREADY_CONNECTED' }
    | { code: 'DISCONNECTED_DURING_TRANSFER'; cause: unknown };
```

## UI / UX

- **Settings page** — `src/modules/Workspace/presentations/views/Settings/ControlSurfacesTab.tsx` (create if absent). A "Push 2 / Push 3" card with: status LED, Connect / Disconnect buttons, mode indicator, current scale and root note selectors, encoder mapping preview.
- **Command Palette entries** — existing `connect-push-2` / `connect-push-3`; add `Push: Disconnect`, `Push: Session Mode`, `Push: Note Mode`, `Push: Drum Mode`.
- **On-screen Push view (optional, v2)** — virtual Push showing the hardware state for users without the hardware (for tutorials / debugging). Out of scope for v1.
- **Connect flow** — on click, browser prompts for USB + MIDI permissions. On success, hardware LEDs flash a welcome pattern (via pre-canned SysEx sequence) and LCD shows "Sourdaw connected".

## Data model / persistence

Push state is **session-local**. A persisted config block in user settings (not per-project) stores:

```ts
type UserSettings = {
    // ...
    pushHardware?: {
        enabled: boolean;
        model: 'push2' | 'push3';
        defaultPadMode: PushPadMode;
        defaultRootNote: number;
        defaultScaleName: string;
        encoderMappings: Array<{ index: number; parameterPath: string; label: string }>;
    };
};
```

These settings rehydrate on app start; if `enabled: true` the driver attempts to connect automatically (silent failure with a toast if the device is not plugged in).

Not persisted in `ProjectData`: the Push is a controller, not a project asset.

## Integration points

- `src/modules/Plugin/useCases/pushIntegration/` — existing use-cases stay; the new driver calls them in response to hardware events.
- `src/modules/Plugin/stores/push.ts` — unchanged.
- `src/modules/PushHardware/` — NEW module with the driver stack.
- `src/modules/Command/useCases/executeAppAction.ts` — routes the 6 new actions.
- `src/modules/Command/models/AppAction.ts` — 5 new action variants.
- `src/modules/Arrangement/stores/trackStore.ts` — subscription target for session-mode rendering.
- `src/modules/Transport/stores/transportStore.ts` — subscription target for Play/Stop LED.
- `src/modules/Toaster/` — drum-mode pad presses dispatch `triggerToasterPad` through the existing use-case.
- `src/modules/MIDI/` — note-mode pad presses feed into the existing MIDI playback path.
- `src/modules/ScratchPad/` or wherever scenes live — session-mode pad presses dispatch `triggerScene`.
- Worker for framebuffer rendering: off-thread bitmap composition so LCD updates don't stall the UI. Optional; only necessary if perf demands. Start on-thread.

## Risks / open questions

- **Browser support** — Chrome has Web USB + Web MIDI + sysex. Firefox has **no** Web USB. Safari has Web MIDI but **not** Web USB. Decision: feature-detect; disable Push on browsers without Web USB (surface a "Push requires Chromium-based browser or the desktop app" notice). On Tauri desktop, use native `tauri-plugin-usb` + `tauri-plugin-midi`.
- **Latency** — MIDI events from the Push to JS land in ~3–5 ms. Colour updates via SysEx take ~10 ms roundtrip. LCD framebuffer is 20 KB; at USB 2.0 it is <1 ms for the transfer but we debounce at 30 Hz anyway to avoid flooding.
- **Hot-unplug** — if the USB device disappears, `transferOut` throws. Catch, dispatch `disconnectPush`, notify user. Implement reconnect-on-reinsert via `navigator.usb.ondisconnect`.
- **Push 3** — has a different LCD (touchscreen) and different protocol. v1 targets Push 2 only; Push 3 support is a separate spec. Mark `push3` paths as "not implemented" and show a notice.
- **Button map** — the full Push button set (~40) mapping to AppActions is labour-intensive. Start with essentials: Play, Stop, Record, Metronome, Undo, Redo, Session, Note, Drum, Scale, Up/Down/Left/Right nav. Others emit a generic `button-press` event for later mapping.
- **Cycle detection** — the driver must not send hardware updates in response to its own hardware-originated updates (would cause pad flash loops). Use a short-lived "originated from hardware" flag on each store update, checked by the driver's subscription.
- **Performance of session-mode repaint** — when the user scrolls tracks, the 64 pad colour recompute + SysEx send must not interfere with audio scheduling. The hardware I/O runs on the main thread; keep the computation O(64) and batch SysEx.
- **SharedArrayBuffer interaction** — none; Push is not an audio-thread concern.
- **Open question**: should encoders control "selected device params" or "selected track volumes" by default? Recommendation: default to selected device; provide a toggle.

## Milestones

### M1 — Transport primitives (one session)

- `createPushMidi`, `createPushUsb` with permission flow.
- `midiCodec` decode + encode.
- `framebufferRenderer` text-only.
- Unit tests with fake MIDI/USB doubles.

### M2 — Driver attach/detach + hello world (one session)

- `attachDriver` subscribes to stores, opens connections, sends a "hello" pattern (row of coloured pads + LCD text).
- `detachDriver` cleans up.
- `handlePadPress`/`handlePadRelease` called from real hardware events.
- Hot-unplug recovery.

### M3 — Mode rendering + input routing (one session)

- `renderSessionMode`, `renderNoteMode`, `renderDrumMode`.
- `routePadPress(mode)` → AppAction dispatch.
- Function button handler map for essentials (Play / Stop / Record / metronome / undo / redo / Session / Note / Drum / Scale / arrow nav).
- Mode-change (hardware button) flips `pushStore.padMode` and re-renders.

### M4 — Encoders + touch strip + LCD (one session)

- Relative encoder decode + mapping to selected-device first 8 parameters.
- Touch strip → pitch bend on armed MIDI tracks.
- LCD updates showing track/param labels (2 lines of context + 2 lines of values).
- `setPushDisplayLine` AppAction.

### M5 — User settings + Push 3 stub (one session)

- `UserSettings.pushHardware` schema + persistence.
- Auto-connect on app start when `enabled`.
- Push 3 detection path that surfaces "not yet supported" gracefully.
- Settings UI tab.

## Tests

- **midiCodec** — 20 unit cases: pad press/release, each velocity curve, relative-encoder 2's-complement quirks (0x41 = +1, 0x3F = -1, 0x7F = -1 on some docs), sysex build.
- **framebufferRenderer** — render 4 lines of ASCII, assert output byte length is exactly 20 480, assert the XOR mask is applied (fixed bytes match a golden reference).
- **Driver attach/detach** — with mocked `PushMidiPort` and `PushUsbDisplay`: assert welcome sequence is sent on attach, subscriptions are created, `detachDriver` closes both and unsubscribes.
- **Cycle detection** — dispatch a hardware pad press → store updates → driver must NOT re-send pad colour for the same pad within the cycle window.
- **Session-mode render** — given 4 tracks × 3 scenes, assert the 8×8 pad grid reflects correctly sampled colours from `trackStore`.
- **Drum mode dispatch** — simulate a pad press in drum mode, assert `triggerToasterPad` was dispatched with the correct pad index.
- **Encoder delta** — decode a CC 71 delta of +3, assert the mapped parameter moved by the correct step (modulated by shift modifier if implemented).
- **Hot-unplug** — simulate USB disconnect mid-write, assert `disconnectPush` is dispatched and no throw reaches the top.
- **Persistence** — `UserSettings.pushHardware` round-trip.
- **Browser gating** — `createPushUsb` returns `USB_UNSUPPORTED` in a Firefox-UA test.
- **E2E (manual, documented in `docs/testing/push.md`)** — because real hardware is required. 10-step checklist of connect, mode switch, pad press, encoder turn, LCD update, disconnect, reconnect.
