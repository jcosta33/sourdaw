# WebDAW Differentiators

## Context

This spec defines the critical feature gaps that must be closed for WebDAW to be competitive and strongly differentiated in the market. It is derived from the gap analysis between the "Killer Features" proposal and the current codebase state, focusing on Tier 1 (Must Have), Tier 2 (Strong Differentiators), and Tier 3 (Future Roadmap) capabilities.
Reference relevant research: `.agents/research/global/killer-features.md`

---

## Goal

To comprehensively implement the missing recording, editing, mixing, AI, collaboration, and workflow features that define the core value proposition and competitive edge of WebDAW. When this is done, WebDAW will offer a complete, AI-augmented, collaborative, and professional-grade production environment.

---

## User-visible behavior

- **Recording & Editing:** Users experience intelligent assistance with AI-suggested comping (scored by pitch/timing/tone), natural phrase boundary punch-ins, AI-powered tempo detection for rubato/syncopation, and optimal warp mode auto-detection. They can utilize dynamic pre-insert clip gain, ML-based transient detection (94%+ accuracy), and advanced MIDI tools (groove pools, swing quantize, probability, scale lock).
- **Mixing & Routing:** Users can build complex mix architectures with nested VCAs, a visual node-based routing diagram, a visual sidechain relationship map, and flexible send/return options (pre/post-fader, 8+ sends). They can integrate external gear with automatic latency compensation (ping) and control surfaces via MCU, HUI, and OSC.
- **Collaboration & Workflow:** Users collaborate with presence awareness, graceful plugin degradation (rendered previews), semantic diffing, content-addressable storage, AI-generated commit messages, and project-aware local-first sync. They manage arrangements via a non-destructive scratch pad, configure live performances with follow actions and AI-generated setlists, and utilize a dedicated integrated mastering workspace.
- **AI & Automation:** Users benefit from AI session auto-organization (track categorization, routing, natural-language search) and unified modulation with visual routing and AI-suggested macro mappings.

---

## Scope

## **In scope:**

- **Tier 1 (Must have):**
  - AI-assisted comping and punch-in points.
  - MIDI overdub merge modes, UMP architecture.
  - Explicit ASIO Direct Monitoring protocol integration.
  - Advanced metronome (compound meters, custom samples).
  - Visual tempo track, smooth interpolation, multiple time signatures, AI tempo detection.
  - AI auto-detection for warp modes.
  - Clip gain dynamic breakpoints (pre-insert).
  - Direct Offline Processing (DOP) for stacking operations.
  - ML-based onset detectors (CNNs).
  - MIDI groove pools, swing quantize, probability, Scale lock with fold-to-scale.
  - Nested VCAs, visual routing/sidechain diagrams, 8+ sends (pre/post).
  - Hardware insert automatic latency compensation.
  - MCU, HUI, OSC, and ARA 2 support.
- **Tier 2 (Strong differentiators):**
  - Presence awareness and graceful plugin degradation.
  - Semantic diffing, content-addressable storage, AI-generated commit messages.
  - Project-aware local-first sync.
  - Probability-weighted clip follow actions, AI-suggested chains.
  - Multi-layer audio+MIDI overdub into clip slots.
  - Song-level navigation, program changes, AI setlists.
  - Non-destructive alternative arrangement scratch pad.
  - Integrated mastering page with target loudness and multi-format export.
  - Worker-based extension sandbox.
  - AI session auto-organization and natural-language track search.
  - Unified modulation (relative, visual routing, AI macros).
  - Platform-aware export (Spotify, YouTube) and sidechain-aware stem export.
  - Full mix snapshots with AI-powered diff visualization.
- **Tier 3 (Future roadmap):**
  - Dolby Atmos support (7.1.4 bed, ADM BWF export).
  - Notation (basic score, MusicXML export).
  - Game audio export (Wwise/FMOD).
  - DJ mode.
  - VCV Rack integration (AI-generated modulation patches).

## **Non-goals (explicitly out of scope):**

- Redesigning already implemented baseline features (e.g., basic basic takes, CRDT sync, ONNX basics) unless specifically extending them with the missing capabilities outlined.
- Developing proprietary plugin formats outside of existing VST3/CLAP/Web extension models.

---

## Requirements

Due to the sheer volume of features, implementation is structured into logical phases:

### Phase 1: AI-Assisted Recording & Intelligent Audio Processing
1. **AI Comping & Punch-in** — The system must score takes by pitch/timing/tone and suggest natural phrase boundary punch points.
2. **CNN Audio Processing** — The system must utilize ML-based CNNs for 94%+ accurate onset detection, AI for tempo detection of rubato/syncopation, and AI for material type auto-detection to set optimal elastique warp modes.

### Phase 2: Advanced MIDI Tools & Modulation
3. **MIDI Intelligence** — The system must provide MIDI groove extraction/application, swing quantization, note probability, scale locking with fold-to-scale, and native UMP (MIDI 2.0) architecture.
4. **Unified Modulation** — The system must implement relative modulation with visual routing and AI-suggested macro mappings.

### Phase 3: Visual Routing & Complex Mixing
5. **Node-based Routing** — The system must render interactive node-based routing and sidechain relationship diagrams.
6. **Advanced Mixing Console** — The system must support nested VCAs, pre/post-fader sends (minimum 8 per channel), and hardware insert latency compensation via ping.

### Phase 4: Collaboration, Sync & Workspaces
7. **Git-like Versioning** — The CRDT engine must support presence awareness, semantic diffing, content-addressable audio storage, project-aware local-first sync (no locking conflicts), and AI-generated commit messages.
8. **Workflow Innovations** — The UI must include a non-destructive arrangement scratch pad, an integrated mastering page with loudness presets, AI session auto-organization with natural-language search, and mix recall snapshots with visual diffing.

### Phase 5: Hardware & Extensibility
9. **Extensibility & Hardware** — The system must support MCU, HUI, OSC, ARA 2, and feature a worker-based extension sandbox for third-party scripts/plugins.

### Phase 6: Export & Future Delivery (Tier 3)
10. **Delivery Manager** — The system must support platform-aware export presets, sidechain-aware stem export, ADM BWF Atmos export, and Wwise/FMOD game audio export.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`).
- Cross-module dependencies must strictly target module root `index.ts`.
- All AI processing must leverage existing `AiGeneration`, `AiRuntime`, or `BrowserAi` module infrastructure.
- Routing diagrams must reuse existing visualization primitives if available, or isolate new WebGPU/Canvas renderers within the `Routing` or `Workspace` modules.
- Worker-based extension sandbox must follow secure CSP and Worker guidelines without violating `Entitlements.plist` constraints (App Sandbox remains disabled for third-party native plugins, but web extensions are sandboxed via Workers).

---

## Design decisions

### Decision: AI Service Integration Strategy

**Chosen:** Leverage the existing `AiRuntime` and `BrowserAi` modules for local inference (ONNX via `ort`) for transient detection, tempo detection, and comp scoring to ensure low latency and privacy, falling back to cloud APIs only for heavy tasks (like semantic diffing or complex natural-language session organization).
**Considered and rejected:** Cloud-only AI processing (rejected due to latency requirements for DAW operations and offline usage needs).

### Decision: Visual Routing Diagrams

**Chosen:** Implement a node-based interactive Canvas/WebGPU surface within the `Routing` module, distinct from the standard mixer view, to clearly map sidechains and complex nested bus architectures.
**Considered and rejected:** Overloading the standard Mixer channel strips with complex routing wires (rejected due to UI clutter and cognitive overload).

---

## Acceptance criteria

### Phase 1
- [ ] **AC-1.1:** AI takes comping successfully scores and ranks 3 overlapping takes.
- [ ] **AC-1.2:** ML transient detector accurately places markers on a provided drum break with >94% precision.

### Phase 2
- [ ] **AC-2.1:** MIDI groove extraction successfully applies swing quantization from a reference audio clip to a flat MIDI sequence.
- [ ] **AC-2.2:** UMP (MIDI 2.0) packet architecture successfully handles high-resolution velocity.

### Phase 3
- [ ] **AC-3.1:** Visual routing diagram correctly renders a feedback-free directed acyclic graph of a nested VCA and sidechain setup.
- [ ] **AC-3.2:** Hardware latency ping correctly calculates round-trip delay in milliseconds.

### Phase 4
- [ ] **AC-4.1:** Semantic diffing successfully visualizes the difference between two mix snapshots.
- [ ] **AC-4.2:** Project-aware local-first sync resolves a mock conflict without data loss.

### Phase 5 & 6
- [ ] **AC-5.1:** Worker-based sandbox successfully loads and executes a mock extension without accessing the main thread DOM.
- [ ] **AC-6.1:** Sidechain-aware stem export outputs discrete audio files that retain sidechain pumping character.

### Global
- [ ] **AC-G.1:** `pnpm deps:validate` passes with zero violations.

---

## Implementation notes

- **Recording & Takes**: Extend `src/modules/Arrangement/stores/groupComping.ts` with scoring metadata models (pitch/timing/tone arrays). The AI scoring logic itself should reside in `src/modules/AudioAnalysis/useCases/` or `src/modules/AiRuntime/services/`.
- **Intelligent Audio Processing (Transient/Tempo/Warp)**: Isolate the ONNX models and CNN processing loops inside `src/modules/BrowserAi/workers/` to prevent audio thread dropouts. Provide the analysis results back to `src/modules/AudioAnalysis/repositories/`.
- **Routing Visuals**: The state for the node-based sidechain and VCA network should be modeled in `src/modules/Routing/models/` and managed by `src/modules/Routing/stores/`. The interactive Canvas/WebGPU renderer itself should be a presentation view (similar to `SpatialMapRenderer` from `SampleLibrary`).
- **Advanced MIDI Tools**: Define the native UMP (MIDI 2.0) packet structures in `src/modules/MIDI/models/`. The groove templates and probability generation use cases must live in `src/modules/MIDI/useCases/`.
- **Collaboration & Git-like Sync**: Extend the existing CRDT setup in `src/modules/CrdtDocument/workers/` and `src/modules/CrdtDocument/stores/` to support project-aware syncing and mix diffing.
- **Extension Sandbox**: The `Extension` module should manage the Worker lifecycle and expose a strictly typed, bi-directional RPC bridge for the DAW API. App Sandbox remains disabled for native plugins in Tauri `Entitlements.plist`, so sandboxing applies strictly to web-based extensions (Workers).

---

## Test plan

- [ ] **Manual step** — Record 3 vocal takes; observe AI scoring and suggested comp lane (Phase 1).
- [ ] **Manual step** — Create a complex sidechain routing; open the Routing map and verify correct node connections (Phase 3).
- [ ] **Automated** — Unit tests for the CNN transient detection accuracy against a known dataset (Phase 1).
- [ ] **Automated** — Integration tests verifying that project-aware local-first sync resolves a mock conflict without data loss (Phase 4).

---

## Open questions

- [ ] **[CRITICAL]** Do we have an existing trained CNN model for transient detection, or does this require a dedicated ML training sprint?
- [ ] **[MINOR]** Should the AI-generated commit messages be fully automated, or presented as a draft for user approval before committing the snapshot?

---

## Tradeoffs and risks

- **Performance Overhead:** Running multiple local AI models (comping, tempo, transient) concurrently could spike CPU usage, risking audio thread dropouts if not strictly isolated to background Web Workers.
- **Complexity:** The sheer volume of features (especially ARA 2, Atmos, and MCU/HUI protocols) risks diluting development focus. Phased implementation is required.