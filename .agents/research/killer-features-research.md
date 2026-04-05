# Killer Features Research & Codebase Annotations

This document tracks the gap between the "Killer Features" proposal and the current WebDAW codebase. Features that are already fully implemented exactly as proposed (e.g., ONNX via `ort`, basic VCA faders, Ableton Link, CV/Gate, CRDT-based real-time collaboration, VST3/CLAP hosting, basic takes, swipe comping, and QuickPunch) have been removed or reduced to their missing sub-components.

---

## TIER 1 — Must have or the DAW isn't competitive

### Recording & Takes

- **Takes and comping**: Basic takes and multi-track group comping are implemented (`groupComping.ts`, `selectTake`).
    - **Missing**: Configurable crossfades, named comp variants, and **AI-assisted comping** (scoring takes by pitch/timing/tone).
- **Punch recording**: QuickPunch is implemented (`toggle-punch-recording`).
    - **Missing**: AI-suggested punch-in/out points at natural phrase boundaries.
- **Loop recording**:
    - **Missing**: MIDI overdub merge modes.
- **Input monitoring**: Rust audio engine via CPAL is implemented.
    - **Missing**: Explicit ASIO Direct Monitoring protocol integration.
- **Click track and metronome**: Basic metronome implemented (`toggle-metronome`).
    - **Missing**: Compound meter support (e.g., dotted quarter notes in 6/8) and custom sample loading.

### Editing Tools

- **Tempo maps and time signatures**:
    - **Missing**: Visual tempo track, smooth interpolation, multiple time signatures, and AI-powered tempo detection for rubato/syncopation.
- **Audio warping**: `élastique Pro` is implemented (`set-warp-elastique`).
    - **Missing**: AI auto-detection of material type to select optimal warp mode.
- **Clip gain**:
    - **Missing**: Dynamic breakpoints applied pre-insert.
- **Offline processing**:
    - **Missing**: Non-destructive Direct Offline Processing (DOP) for stacking operations.
- **Transient detection**:
    - **Missing**: ML-based onset detectors (CNNs) for 94%+ accuracy.
- **MIDI Tools**:
    - **Missing**: MIDI groove pools (extracting groove from audio/MIDI to apply to programmed parts), swing quantize, MIDI note probability, and Scale lock with fold-to-scale.

### Mixing Features

- **VCA fader groups**: Implemented (`createVcaGroup`, `assignToVca`).
    - **Missing**: Nested VCAs.
- **Routing & Buses**:
    - **Missing**: Flexible group/bus/folder routing and a visual, node-based routing diagram.
- **Sends & Returns**:
    - **Missing**: Pre-fader and post-fader options, with at least 8 sends per channel.
- **Hardware inserts**:
    - **Missing**: Automatic latency compensation (ping function).
- **Sidechain routing**:
    - **Missing**: Visual sidechain relationship map.
- **Control surface protocols**:
    - **Missing**: Mackie Control (MCU), HUI, and OSC support.
- **ARA 2 support**:
    - **Missing**: Entirely absent. Mandatory for Melodyne/VocAlign integration.

### Emerging Tech

- **MIDI 2.0**:
    - **Missing**: Native UMP (Universal MIDI Packet) architecture.

---

## TIER 2 — Strong differentiators

### Collaboration & Cloud

- **Collaboration**: CRDT real-time sync is implemented (`AutomergeStorage.ts`).
    - **Missing**: Presence awareness, graceful plugin degradation (rendered audio previews for missing plugins).
- **Version control**:
    - **Missing**: Semantic diffing, content-addressable audio storage, AI-generated commit messages.
- **Cloud storage**:
    - **Missing**: Project-aware local-first sync to avoid file-locking conflicts.

### Live Performance

- **Follow actions for clips**:
    - **Missing**: Probability-weighted actions and AI-suggested chains.
- **Integrated loop station**:
    - **Missing**: Multi-layer audio+MIDI overdub into clip slots.
- **Setlist management**:
    - **Missing**: Song-level navigation, program changes, and AI-generated setlists.

### Workflow Innovations

- **Scratch pad for arrangement**:
    - **Missing**: Non-destructive alternative arrangement area.
- **Integrated mastering page**:
    - **Missing**: Separate workspace with target loudness presets and multi-format export.
- **Plugin sandboxing**:
    - **Missing/Disabled**: App Sandbox is explicitly disabled in `Entitlements.plist` for third-party plugins. Worker-based extension sandbox is marked as a TODO in `miscCommands.ts`.
- **AI session auto-organization**:
    - **Missing**: Auto-categorization of tracks, grouping, routing, and natural-language track search.
- **Unified modulation**:
    - **Missing**: Relative modulation, visual routing diagram, and AI-suggested macro mappings.

### Export & Recall

- **Delivery manager**:
    - **Missing**: Platform-aware export (Spotify, YouTube, podcast presets).
- **Sidechain-aware stem export**:
    - **Missing**: Exporting stems that respect sidechain and send dependencies.
- **Mix recall**:
    - **Missing**: Full mix snapshots including automation and AI-powered diff visualization.

---

## TIER 3 — Nice to have or future roadmap

- **Dolby Atmos support**: **Missing**. Needs 7.1.4 bed support and ADM BWF export.
- **Notation**: **Missing**. Basic score display and MusicXML export.
- **Game audio**: **Missing**. Native Wwise/FMOD export.
- **DJ mode**: **Missing**.
- **VCV Rack integration**: CV/Gate is implemented, but VCV Rack specific integration and AI-generated modulation patches are **missing**.
