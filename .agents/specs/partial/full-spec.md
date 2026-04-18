# Sourdaw — Consolidated Spec: Unimplemented Features & Differentiators

**Actionable spec for features that are NOT yet implemented and NOT covered by a dedicated spec file.**

Consolidated from the 16-research-document technical reference and `differentiators.md`. Every item cross-referenced against the codebase as of 2026-04-18.

## Architectural constraints (from AGENTS.md — non-negotiable)

- **Module boundaries**: cross-module imports target root `index.ts` only. Models are private to their owning module. One function per file in `useCases/` and `repositories/`.
- **New modules** follow the DDD pattern: `src/modules/<Name>/` with `models/`, `stores/`, `useCases/`, `handlers/`, `repositories/`, `presentations/`, `events/`, and root `index.ts` exporting only from `useCases/`, `events/`, `stores/`, `presentations/views/`.
- **No `useMemo`/`useCallback`/`React.memo`/`forwardRef`** — React Compiler handles memoization; `ref` is a regular prop.
- **Type soundness**: no `any`, no `as` casts to silence errors, no `@ts-expect-error` without justification. Prefer `type` over `interface`, `as const` over `enum`.
- **Audio thread**: no allocation, no mutex locks, no blocking. Lock-free ring buffers (`rtrb`) and atomics only.
- **Styling**: Tailwind V4 classes via `@theme` variables exclusively.
- **Run `pnpm deps:validate`** after every batch of cross-module changes — zero violations required.

For features covered by dedicated specs, see:
- `specs/missing/` — 16 unimplemented feature specs (articulation-maps, atmos, bakery, etc.)
- `specs/partial/` — audio-generation, drum-machine, workflow-ui
- `specs/implemented/` — 18 completed specs

---

## Product direction

Build the parts that solve real production pain:

- too many alternate versions with no structure
- expressive performance data getting flattened or lost
- ideas living outside the session
- browser/desktop projects drifting apart
- AI doing opaque or destructive things
- users not knowing what engine, quality, or fallback they are hearing

**Sourdaw should be: a fast, local-first DAW with branch-native creation, durable expression, integrated project memory, explicit AI control, and honest runtime transparency.**

### Core principles

1. **Music first** — every system must make writing, editing, arranging, performing, comping, and comparing faster
2. **Branch first** — alternatives should be native to the session, not hacked with duplicate tracks and muted clips
3. **Preserve meaning** — performance expression, version lineage, and user intent should survive edits, transforms, exports, and runtime changes
4. **No invisible state** — if playback, rendering, AI, or runtime conditions changed what the user hears, the DAW must say so
5. **AI must be subordinate** — AI can suggest, branch, transform, refine. It must not silently overwrite, obscure authorship, or hide its mode
6. **Browser and desktop are one project** — same session must remain coherent across light preview and heavyweight native rendering
7. **Advanced features must stay lightweight** — no feature should require systems architect thinking to finish a song

---

# Phase 1 — Real differentiators

## 1. Variation-native clips and branches

### Current state

The codebase has foundational pieces:
- **Project-level branching** via Automerge CRDT (`src/modules/CrdtDocument/useCases/crdtBranching/`) — fork, switch, merge, delete branches. UI in `BranchManagerDialog.tsx`. Production-ready.
- **Track alternatives** (`Track.alternatives[]`, `activeAlternativeId`) with create/switch/delete. UI in `TrackAlternativesSection.tsx`.
- **Linked clips** (`Clip.parentClipId`, `isLinkedInstance`, `overrides`) for pattern instances.
- **AI-generated variations** via `generateMidiVariations.ts` placing alternatives sequentially.

### What's missing

None of these are unified into a **clip-level variation system** with the UX described below. The pieces exist in isolation — branching is project-wide, alternatives are track-wide, linked clips are a separate concept. There's no clip-level "Variants" affordance.

### What to build

**Clip and section variants** — any clip or arrangement section can hold structured alternatives:

- **Variants affordance** visible on every clip (small indicator showing variant count)
- Variants appear as siblings, not hidden internal states
- Actions: audition in place, compare (A/B), promote to mainline, archive, keep as shadow, merge selected attributes
- **Diff summaries** in human-readable form: "notes changed", "timing changed", "sound changed", "mix changed"
- Every artifact carries lineage metadata: original, forked, derived, merged
- Branch merges support: note merge, phrase replace, timing merge, expressive merge, mix-state merge

### Minimum quality bar

A user creates three alternate choruses, auditions them in place, keeps two as attached history, and merges the phrasing from one with the timbral treatment of another — without session clutter.

### Implementation guidance

The `Clip` type lives in `src/modules/Arrangement/models/Track.ts` (line 74). It already has `parentClipId`, `isLinkedInstance`, and `overrides` fields for the linked-instance pattern (H1). Variants need a different shape — linked instances share content and propagate changes; variants are independent snapshots that diverge.

**Data model** — add to the `Clip` type:
```
variantGroupId?: string;    // All variants in a group share this ID
variantLabel?: string;      // "A", "B", "Original", "AI suggestion #2"
variantSource?: 'user' | 'ai' | 'collaborator' | 'import';
variantCreatedAt?: number;  // Unix epoch ms
```

Clips with the same `variantGroupId` are siblings. The active variant is the one currently on the track timeline; archived variants are stored in `TrackAlternative` (which already exists at line 9: `{ id, name, clips: Clip[] }`). This reuses the existing alternative infrastructure rather than creating a parallel system.

**Use cases** — create in `src/modules/Arrangement/useCases/variants/`:
- `createVariant.ts` — snapshot current clip content (MIDI notes from `midiStore` + clip properties), assign shared `variantGroupId`, store original in alternatives
- `promoteVariant.ts` — swap an archived variant to the active timeline position, archive the current one
- `compareVariants.ts` — generate a human-readable diff summary between two variants (note count, pitch range, duration, expression data presence)
- `mergeVariantAttributes.ts` — selective merge: take timing from variant A, notes from variant B

**UI** — add a variant count badge to clip rendering in `src/modules/Arrangement/presentations/renderers/clipDrawing.ts`. Add a `VariantPanel` in `src/modules/Arrangement/presentations/components/` showing the variant list for the selected clip with audition/promote/archive buttons.

**Audition** — temporarily swap the active clip's MIDI data for a variant's data during playback without committing. Use `midiStore` to hot-swap `notesByClipId[clipId]` and restore on audition end.

---

## 2. Runtime transparency strip

### Current state

`StatusBar.tsx` shows CPU %, memory, sample rate, latency, engine state, and master level. This is basic engine metrics, not runtime execution transparency.

### What's missing

No indication of:
- Whether playback is preview or final quality
- Whether a cached, stale, or freshly rendered result is playing
- Which engine/backend is active for each track
- Whether any fallback occurred
- What fidelity tier the session is running at

### What to build

A persistent, compact **Runtime Strip** (can be integrated into the existing status bar) showing:

- **Runtime class**: browser-wasm / native-rust / hybrid
- **Session mode**: sketch / preview / production / final-render
- **Fidelity tier**: what quality level is active and why
- **Fallback state**: whether any component fell back to a lower-quality path
- **Queue state**: pending renders, stale phrases awaiting re-render

Status language must be blunt: `ready`, `preview render`, `downgraded — missing component`, `stale — needs re-render`, `blocked by capability`.

Expandable details answer: why this engine was selected, why a fallback happened, what would improve quality.

### Minimum quality bar

The user can always tell whether they're hearing a cached result, a preview, a downgraded result, or a final render. No hidden fallback paths.

### Implementation guidance

The StatusBar lives at `src/modules/Workspace/presentations/views/StatusBar.tsx`. It already reads `llmStatusStore` and `renderQueueStore` for AI/render status. The `renderQueueStore` (`src/modules/BrowserAi/stores/renderQueueStore.ts`) already tracks `PhraseRenderStatus` with values: `not-rendered`, `queued`, `preparing`, `rendering-browser`, `rendering-native`, `preview`, `final`, `stale`, `error`. The infrastructure for status is partially there — it just isn't surfaced to the user as runtime transparency.

**Store** — create `src/modules/Workspace/stores/runtimeTransparencyStore.ts`:
```
type RuntimeTransparency = {
    runtimeClass: 'browser-wasm' | 'native-rust' | 'hybrid';
    sessionMode: 'sketch' | 'preview' | 'production' | 'final-render';
    fidelityTier: string;          // e.g. "full native DSP" or "browser preview — no native plugins"
    fallbacks: RuntimeFallback[];  // active fallback explanations
    stalePhraseCount: number;      // from renderQueueStore
    pendingRenderCount: number;    // from renderQueueStore
};

type RuntimeFallback = {
    component: string;    // e.g. "DiffSinger", "native plugin host"
    reason: string;       // e.g. "WebGPU unavailable", "Tauri not detected"
    degradation: string;  // e.g. "using CPU inference instead of GPU"
};
```

**Aggregation** — subscribe to `platformCapabilities` (from `src/utils/platformCapabilities.ts`), `capabilityStore` (from `src/modules/BrowserAi/stores/capabilityStore.ts`), and `renderQueueStore`. Derive `runtimeClass` from `isTauri()`. Derive `fallbacks` from capability detection results (e.g., WebGPU tier = "unavailable" → fallback entry).

**UI** — add a compact segment to `StatusBar.tsx` showing the runtime class and a colored dot (green = production, amber = preview, red = degraded). Clicking expands a dropdown with the full fallback list and explanations. No new panel — keep it in the status bar.

---

## 3. Explicit trust modes for AI operations

### Current state

AI backend selection exists (`AiSection.tsx` — native/cloud/webllm/none). Confirmation dialogs exist for destructive operations (`requiresConfirmation` in PromptBar). Undo support for AI actions exists.

### What's missing

No structured trust mode system. AI operations don't declare their autonomy level or reversibility before running. No per-operation scope declaration.

### What to build

Every AI action declares its trust mode before execution:

| Mode | Behavior |
|------|----------|
| **Suggest only** | Show ghost clips/notes, no session changes |
| **Create branch** | Results go to a new variant, never touch mainline |
| **Apply reversible delta** | Modify in place with full undo |
| **Replace selection** | Overwrite selected content (requires confirmation) |
| **Destructive commit** | Permanent change (e.g., bounce with AI processing) |
| **Analyze only** | Read-only inspection, no output artifacts |

### UX

- Default mode is **create branch** for stochastic generation (MIDI generation, variations)
- Default mode is **suggest only** for analysis features (mix analysis, EQ suggestions)
- Every AI surface shows: selected trust mode, affected scope, whether a branch is created, whether the result is reversible
- Trust mode is enforced by execution logic, not just UI

### Minimum quality bar

No AI-assisted action may silently replace mainline creative material unless the user explicitly chose a destructive mode.

### Implementation guidance

The AI execution pipeline has three independent dispatch paths that all need trust mode enforcement:
- `src/modules/AiRuntime/useCases/sendChatMessage.ts` (~296 LOC) — chat-based AI with its own backend dispatch
- `src/modules/AiRuntime/useCases/dsoEditor/executeDsoEdit.ts` (~451 LOC) — DSO editor with private `invokeLlm`
- `src/modules/AiRuntime/useCases/inference.ts` — `generateToolCalls` with separate backend dispatch

Ghost clip infrastructure already exists: `Clip.isGhost` (line 99 of `Track.ts`), `acceptGhostClip.ts` and `dismissGhostClip.ts` in `src/modules/Arrangement/useCases/clip/`, tested in `ghostClips.spec.ts`. The "suggest only" mode maps directly to creating ghost clips.

**Model** — add `src/modules/AiRuntime/models/TrustMode.ts`:
```
type TrustMode = 'suggest-only' | 'create-branch' | 'apply-reversible' | 'replace-selection' | 'destructive-commit' | 'analyze-only';
```

**Enforcement** — add a `trustMode` field to the existing `RuntimeAction` type (`src/modules/AiRuntime/models/RuntimeAction.ts`). Before the action execution step in each pipeline:
- `suggest-only` → create clips with `isGhost: true`, do not modify `midiStore` or `trackStore`
- `create-branch` → use `createVariant()` (from the new variants system above), never touch the active timeline clip
- `apply-reversible` → wrap in undo group (existing `pushUndo` infrastructure)
- `replace-selection` → show confirmation dialog (existing `requiresConfirmation` pattern in PromptBar)
- `destructive-commit` → explicit confirmation + warning
- `analyze-only` → read-only, produce analysis output, no session mutations

**Default assignment** — each AI feature declares its default trust mode. Generation features default to `create-branch`. Analysis features default to `analyze-only`. The user can override per-invocation via a dropdown in the PromptBar or context menu.

**UI** — add a trust mode selector (small segmented control or dropdown) to the PromptBar component at `src/modules/Workspace/presentations/views/PromptBar.tsx`. Show the active mode and affected scope before execution.

---

## 4. Capture-anything project memory

### Current state

- **ScratchPad** exists (`scratchPadStore.ts`, `ScratchPadView.tsx`) for capturing arrangement sections — but this is arrangement-focused, not a general capture inbox
- **Voice input** exists for AI commands but not for voice memos attached to timeline
- **Track notes/comments** exist as text per track
- **In-session comments** exist as threaded comments pinned to timeline

### What's missing

No unified capture inbox for voice memos, rough lyrics, screenshots, reference audio, spoken instructions, or quick ideas. No way to attach a voice memo to a timeline range and later search/transcribe it.

### What to build

A **Capture Inbox** that is always close at hand:

- **Supported inputs**: voice notes, spoken instructions, humming, text notes, reference audio, collaborator comments, timeline bookmarks, plugin/chain snapshots
- **Actions**: capture instantly from anywhere, attach to bars/clips/tracks/sections, transcribe voice memos, jump from transcript to timeline, convert a note into a task/branch/intent
- Raw capture and derived result stay linked

### Technical direction

Each memory artifact stores: raw payload, derived payload (transcript), linked scope (timeline range), timestamp, tags, search index.

### Minimum quality bar

A user records a spoken note "make bars 17 to 21 hit harder," attaches it to that range, finds it later in search, and converts it to an actionable operation without losing the original memo.

### Implementation guidance

**Module** — create `src/modules/ProjectMemory/` following the DDD pattern:
- `models/MemoryArtifact.ts` — type with `id`, `rawPayload` (audio blob URL or text), `derivedPayload` (transcript text), `linkedScope` (optional `{ trackId?, startBeat?, endBeat? }`), `timestamp`, `tags: string[]`, `artifactType: 'voice-note' | 'text-note' | 'reference-audio' | 'screenshot' | 'bookmark'`
- `stores/projectMemoryStore.ts` — `Store<{ artifacts: MemoryArtifact[] }>` following the `Store<T>` pattern used throughout the codebase (e.g., `scratchPadStore.ts`)
- `useCases/captureVoiceNote.ts` — uses `navigator.mediaDevices.getUserMedia()` for recording (same pattern as audio recording in Transport module), stores blob in `audioBufferCache`
- `useCases/transcribeArtifact.ts` — uses existing whisper integration via `src-tauri/src/commands/speech.rs` (Tauri) or Web Speech API fallback
- `useCases/searchArtifacts.ts` — full-text search over artifact text/transcripts/tags
- `useCases/linkArtifactToTimeline.ts` — attach a `linkedScope` to an artifact
- `presentations/views/CaptureInbox.tsx` — collapsible panel, toggled via keyboard shortcut, shows artifact list with search bar and capture button

**Persistence** — extend `ProjectData` at `src/modules/Project/models/ProjectData.ts` with `memoryArtifacts?: MemoryArtifact[]` (using Arrangement's local type duplication pattern per AGENTS.md model isolation rules — define a `ProjectMemoryArtifact` type locally in the Project module).

**Voice capture** — the existing voice input in `src/modules/AiRuntime/useCases/voiceInput/` captures audio for AI commands. The pattern is reusable but the output needs to be stored as a project artifact instead of piped to the LLM. Create a separate capture flow that records, stores, and optionally transcribes.

**Keyboard shortcut** — register a global shortcut (e.g., `Shift+M`) in `src/modules/Workspace/presentations/hooks/handleKeydown.ts` to toggle the capture inbox panel.

---

## 5. Hardware-adaptive session modes

### Current state

No session mode system exists. The app runs at whatever quality the hardware supports with no adaptive behavior.

Capability detection exists:
- `src/utils/capabilities.ts` — `isTauri()`, `hasSharedArrayBuffer()`, `isCrossOriginIsolated()`
- `src/utils/platformCapabilities.ts` — native plugins, MIDI, voice commands, file dialogs
- `src/modules/BrowserAi/repositories/capabilityDetector.ts` — WebGPU tier classification

### What to build

A small set of clear session modes that are execution policies, not marketing labels:

| Mode | Behavior |
|------|----------|
| **Sketch** | Minimal resources, fast startup, basic synths, no heavy DSP |
| **Preview** | Standard quality, browser-compatible, lightweight effects |
| **Production** | Full native DSP, all plugins loaded, highest quality |
| **Final render** | Offline, maximum quality, no real-time constraints |

Users can also choose a bias: preserve interactivity, prioritize quality, conserve power, background refine.

### Minimum quality bar

A project opened on a lightweight browser runtime stays editable and musically meaningful. The same project on desktop upgrades render quality without breaking continuity.

### Implementation guidance

**Do NOT create a new module.** Session modes are a cross-cutting concern, not a domain boundary. Implement as:

- `src/utils/sessionMode.ts` — a `Store<SessionModeState>` holding the current mode and computed fidelity info. Reads `platformCapabilities` and `capabilityDetector` on init. Subscribes to runtime changes (e.g., Tauri becoming available, WebGPU detection completing).
- `SessionModeState` type: `{ mode: 'sketch' | 'preview' | 'production' | 'final-render'; bias: 'interactivity' | 'quality' | 'power-save'; detectedCapabilities: PlatformCapabilities; effectiveConstraints: SessionConstraints }`.
- `SessionConstraints` type: `{ maxPolyphony: number; enableNativePlugins: boolean; renderQuality: RenderQuality; enableHeavyDSP: boolean }`.

**Integration points** (each module checks `sessionMode` and adapts):
- `BrowserAi` — `RenderQuality` already exists (`low`/`standard`/`high`/`maximum` in `src/modules/BrowserAi/models/RenderProgress.ts`). Map session modes: sketch→low, preview→standard, production→high, final-render→maximum.
- `AudioEngine` — adjust buffer sizes and voice counts. The Rust crates already support configurable buffer sizes via `cpal`.
- `Arrangement/useCases/freezeBounce/renderOffline.ts` — in final-render mode, use maximum quality settings (highest sample rate, longest reverb tails).

**Persistence** — add `sessionMode?: 'sketch' | 'preview' | 'production' | 'final-render'` to `ProjectData` at `src/modules/Project/models/ProjectData.ts`. Default to auto-detection based on platform capabilities.

**UI** — add a mode selector to the transport bar or status bar. Four clear icons/labels. No complex settings — just the mode and an optional bias preference stored in user preferences.

---

## 6. Capability-aware feature planning

### Current state

Scattered capability checks (`isTauri()`, WebGPU detection) but no unified system that answers "can feature X run here and why not?"

### What to build

A coherent internal capability model that every feature can query:

- Can this run here? Why not? What's the closest compatible path? What degrades if forced?
- Expose clear explanations in context, not a technical graph
- Examples: "native plugin hosting unavailable in browser mode", "this operation needs a model pack not installed"

### Implementation guidance

`src/utils/platformCapabilities.ts` already returns a `PlatformCapabilities` object with boolean flags (`hasNativePlugins`, `hasPluginScanning`, `hasMidiInput`, `hasVoiceCommands`, `hasNativeFileDialogs`, `hasMultiTrackRecording`, `isDesktopApp`) and a `DISABLED_REASONS` object with tooltip messages for disabled features. This is the right file to extend.

**Extend** `platformCapabilities.ts`:
- Add a `canRunFeature(featureId: string): { available: boolean; reason?: string; fallback?: string }` function
- Register feature requirements as a static map: `{ 'native-plugins': { requires: ['isDesktopApp'] }, 'diffsinger-gpu': { requires: ['webgpu-fast'] }, ... }`
- The `reason` field provides the human-readable explanation ("native plugin hosting unavailable in browser mode")
- The `fallback` field suggests the alternative ("use built-in WAM plugins instead")

**UI integration** — create a `useFeatureAvailability(featureId: string)` hook in `src/utils/` that returns the availability result. Components call this to conditionally disable controls and show tooltips. Example: a "Load External Plugin" button checks `canRunFeature('native-plugins')` and shows the reason as a tooltip when disabled.

See `specs/missing/chrome-first-capability.md` for the full architectural vision with branded handle types and per-domain adapters — this task is the minimal viable subset that solves the immediate UX problem.

---

# Phase 2 — Musical depth

## 7. Unified performance expression model

### Current state

Expression data exists but is fragmented:
- `MidiNote` has `pressure`, `slide`, `pitchBend` fields (optional)
- Per-note editing works: `setNotePressure.ts`, `setNotePitchBend.ts`, `setNoteSlide.ts`
- Seven expression lanes in piano roll: pressure, pitch bend, slide, velocity, CC, note property
- MPE enable/disable per track
- Groove extraction/application works
- GrandBoule has per-note physical parameters (hammerHardness, stringStiffness, etc.)

**Critical bug**: `pasteNotes.ts` (line 25) and `pasteClip.ts` (line 51) call `createMidiNote(n.pitch, n.startBeat, n.duration, n.velocity)` which drops `pressure`, `slide`, and `pitchBend`. Expression data is lost on copy/paste.

### What to build

**Fix the expression data loss bug first** — `pasteNotes.ts` and `pasteClip.ts` must preserve all MidiNote fields.

Then build a **Performance Editor** layer:

- Copy notes only / copy expression only / copy notes+expression
- Transfer feel from one phrase to another (extend existing groove extraction)
- Visual overlays showing timing heat, dynamic contour, pitch drift, pressure shape
- When moving material between richer and poorer targets (e.g., MPE synth to basic MIDI), show a **Portability Report**: preserved / approximated / downgraded / unavailable

### Minimum quality bar

A phrase recorded with rich expression is editable semantically, copied with feel intact, moved to a less expressive target with an honest portability report.

### Implementation guidance

**Bug fix (do this first — it's a data loss bug):**

`src/modules/Arrangement/useCases/clipboard/pasteNotes.ts` line 24-25:
```typescript
// BEFORE (drops expression):
const pastedNotes: MidiNote[] = noteClipboard.notes.map((n) =>
    createMidiNote(n.pitch, n.startBeat - minStart + beatOffset, n.duration, n.velocity)
);

// AFTER (preserves all fields):
const pastedNotes: MidiNote[] = noteClipboard.notes.map((n) => ({
    ...n,
    id: `note-${crypto.randomUUID().slice(0, 8)}`,
    startBeat: n.startBeat - minStart + beatOffset,
}));
```

Same fix needed in `src/modules/Arrangement/useCases/clipboard/pasteClip.ts` line 50-51:
```typescript
// BEFORE:
const copiedNotes: MidiNote[] = entry.midiNotes.map((n) =>
    createMidiNote(n.pitch, n.startBeat, n.duration, n.velocity)
);

// AFTER:
const copiedNotes: MidiNote[] = entry.midiNotes.map((n) => ({
    ...n,
    id: `note-${crypto.randomUUID().slice(0, 8)}`,
}));
```

Note: `copySelectedNotes.ts` (line 26) already correctly spreads notes (`{ ...n }`), so all expression data reaches the clipboard — only paste is broken. The `MidiNote` type (both `src/modules/MIDI/models/MidiNote.ts` and the local view type at `src/modules/Arrangement/models/MidiNoteViewTypes.ts`) includes `pressure?: number`, `slide?: number`, `pitchBend?: number`. These fields are properly preserved.

**Expression clipboard modes** — add to `src/modules/Arrangement/useCases/clipboard/`:
- `pasteExpressionOnly.ts` — paste `pressure`, `slide`, `pitchBend`, `velocity` from clipboard notes onto matching notes in the target clip (match by relative position/pitch)
- `pasteNotesWithoutExpression.ts` — paste notes but reset expression fields to defaults

**Performance overlays** — extend the piano roll renderer at `src/modules/Workspace/presentations/hooks/usePianoRollRenderer.ts` with optional overlays:
- Timing heat: color notes by deviation from grid (green = on grid, orange = early, blue = late)
- Dynamic contour: thin line connecting velocity values across the phrase
- These are visualization modes, toggled in the piano roll toolbar

**Portability report** — create `src/modules/MIDI/services/expressionPortability.ts`:
- Input: source `MidiNote[]` + target device capabilities (from the negotiated semantics feature)
- Output: `{ preserved: string[]; approximated: string[]; dropped: string[] }` — e.g., `{ preserved: ['velocity', 'pitch bend'], approximated: ['pressure → CC11'], dropped: ['slide'] }`
- Show as a lightweight toast or inspector panel when pasting across instruments with different capabilities

---

## 8. Negotiated instrument semantics

### Current state

No instrument capability discovery. Devices are treated as parameter sinks. No auto-detection of MPE support, articulation systems, or expression capabilities.

### What to build

When loading a compatible device, discover and display:
- Expressive features (MPE, per-note expression, pressure response)
- Articulation support (keyswitches, CC-based switching)
- Suggested editor profile (show expression lanes, hide irrelevant controls)

### Minimum quality bar

If discovery works, it materially improves editing. If it fails, degrade gracefully to generic control.

### Implementation guidance

Devices are currently defined in the `Clip`/`Track` model at `src/modules/Arrangement/models/Track.ts` (lines 128-136) as `{ id, name, type, bypassed, parameterValues, ... }` — they have no capability metadata.

**Capability type** — add to `src/modules/Arrangement/models/Track.ts` alongside the device type:
```
type DeviceCapabilities = {
    supportsMpe?: boolean;
    supportsPerNotePitchBend?: boolean;
    supportsPerNotePressure?: boolean;
    supportsPerNoteSlide?: boolean;
    articulationSwitching?: 'keyswitch' | 'cc' | 'velocity' | 'none';
    drumMap?: boolean;
    expressionTier: 'basic' | 'extended' | 'full-mpe';
};
```

**Static registration** — for built-in instruments, register capabilities in a lookup table (a `services/` file in the Arrangement module):
- Fermenter → `{ supportsMpe: true, expressionTier: 'full-mpe' }`
- Levain → `{ articulationSwitching: 'keyswitch', expressionTier: 'extended' }`
- Toaster → `{ drumMap: true, expressionTier: 'basic' }`
- GrandBoule → `{ supportsPerNotePitchBend: true, supportsPerNotePressure: true, expressionTier: 'full-mpe' }` (it already has per-note physical params)

**CLAP plugin discovery** — `src-tauri/src/commands/clap_wrapper.rs` can query `CLAP_EXT_NOTE_PORTS` and `CLAP_EXT_PARAMS` to discover note expression support. Emit capabilities back to the frontend via a Tauri command.

**UI adaptation** — the piano roll toolbar at `src/modules/Workspace/presentations/views/ClipView/PianoRollToolbar.tsx` should show/hide expression lane toggles based on the active track's device capabilities. If the device doesn't support pressure, gray out or hide the Pressure lane toggle. If the device is a drum instrument, offer a drum-pad view toggle instead of standard piano roll layout.

---

# Phase 3 — Support systems

## 9. Lightweight goal attachment

### Current state

Track notes/comments exist. No way to attach actionable goals to timeline ranges.

### What to build

Allow attaching requests like "make this chorus wider", "tighten this groove", "darken this pad without losing attack" to timeline ranges. These are practical annotations that can optionally feed into AI operations.

Keep it lightweight, local, and optional. Not a formal ontology.

### Implementation guidance

In-session comments already exist as threaded timeline-pinned notes. The existing marker system (`src/modules/Arrangement/models/Track.ts` — `Marker` type with `beat`, `name`, `color`) provides positional anchoring.

**Extend the Marker type** (or create a sibling `Goal` type in the same model file):
```
type TimelineGoal = {
    id: string;
    text: string;              // "make this chorus wider"
    startBeat: number;
    endBeat: number;
    trackId?: string;          // optional — can target a specific track or the whole arrangement
    resolved: boolean;
    createdAt: number;
};
```

**Store** — add goals to the existing `markerStore` or create a lightweight `goalStore` in the Arrangement module.

**AI integration** — add a "Run as AI prompt" action on each goal. This pipes `goal.text` + the timeline context (selected track, beat range) into the existing `executeAppAction` pipeline. The goal text becomes the user prompt; the beat range becomes the selection context.

**UI** — render goals as colored range markers on the timeline (distinct from regular markers — e.g., dashed border). Show in a list in the Inspector when a range is selected. Add a "Add Goal" option to the timeline context menu.

---

## 10. Passive decision memory

### Current state

No decision tracking. `actionHistoryStore.ts` tracks undo history but not the reasoning behind decisions.

### What to build

Automatically capture decisions from user actions where possible:
- Why a variant was promoted over alternatives
- Why an edit was approved
- Why a mix change was made

This should be generated passively, not turned into mandatory documentation.

### Implementation guidance

The undo system at `src/modules/Workspace/stores/actionHistoryStore.ts` already records action descriptions with a 200-entry cap. Decision memory is metadata on top of this.

**Extend action history entries** with an optional `decisionContext` field:
```
type DecisionContext = {
    reason?: string;          // auto-generated or user-provided
    alternatives?: string[];  // what other options existed (variant labels)
    promotedFrom?: string;    // variant ID if this was a variant promotion
    aiGenerated?: boolean;    // whether the action was AI-suggested
};
```

**Auto-generation triggers** — hook into:
- `acceptGhostClip.ts` → record "accepted AI suggestion for [clip name]"
- `promoteVariant.ts` (from the variants system) → record "promoted variant [label] over [N] alternatives"
- Any undo group labeled with an AI action → record "applied AI [action type]"

**No separate UI panel.** Surface decisions in the existing undo history panel — each entry with a `decisionContext` shows an expandable detail row. Searchable via the existing command palette (`Cmd+K`).

---

# Standalone features (not in any other spec)

## 11. MIDI 2.0 / UMP native architecture

### Current state

MIDI 1.0 only throughout the codebase. `MidiNote` type uses 7-bit velocity (0-127). The GrandBoule piano has a `midi2.rs` file in its Rust DSP crate but this is instrument-specific, not a universal MIDI 2.0 transport.

### What to build

Universal MIDI Packet (UMP) as the internal note representation:
- 32-bit resolution for velocity, pressure, pitch bend (4.3 billion steps vs 128)
- Per-note controllers without MPE channel hacking
- Property Exchange for automatic hardware detection
- Backward-compatible translation to MIDI 1.0 for legacy plugins/hardware

### Why this matters strategically

Every incumbent DAW is retrofitting MIDI 2.0 onto MIDI 1.0 internals. Building UMP-native now means architectural cleanliness competitors cannot easily match.

### Implementation guidance

**This is a long-term architectural preparation, not an immediate build.** The `midir` crate (used in `src-tauri/src/commands/midi.rs`) does not support MIDI 2.0 yet. No Rust crate provides UMP parsing as of April 2026. The GrandBoule piano's `crates/daw-dsp/src/grand_boule/midi2.rs` demonstrates instrument-specific MIDI 2.0 handling but is not a universal transport.

**Phase 1 (now)** — expand the internal note resolution:
- The `MidiNote` type at `src/modules/MIDI/models/MidiNote.ts` uses `velocity: number` stored as 0-127 integer. Keep 7-bit at the storage layer for now but use floating-point (0.0-1.0) at the editing/UI layer, so the transition to 32-bit resolution is a storage change, not a UI rewrite.
- Same for `pressure`, `slide`, `pitchBend` — store as float internally, convert to 7-bit or 14-bit at output boundaries.

**Phase 2 (when ecosystem is ready)** — define `UmpNote` type with 32-bit fields, implement bidirectional translation between `MidiNote` and `UmpNote`, and adopt a Rust UMP crate when one becomes available.

**Decision**: do NOT attempt a full MIDI 2.0 migration now. The ecosystem isn't ready. Focus on making the internal representation resolution-independent so the migration is mechanical when the time comes.

---

## 12. Integrated mastering page

### Current state

No mastering workspace. Proof exists as a mastering suite plugin but there's no Studio One-style Project Page.

### What to build

A separate workspace for mastering that:
- Imports finished mixes as tracks
- Provides per-track and master processing (Proof integration)
- Target loudness presets for streaming services (Spotify -14 LUFS, Apple Music -16 LUFS, YouTube -14 LUFS)
- Multi-format simultaneous export
- Double-click any track to relaunch its mix session

### Implementation guidance

The workspace is managed by `src/modules/Workspace/` with mode switching between Arrange/Mix/Edit views. The Proof module (`src/modules/Proof/`) provides the mastering suite with per-instance state (`proofStore.ts` keyed by deviceId), LUFS metering, and multi-band processing.

**Workspace mode** — add a `'master'` mode to the workspace view switcher in `src/modules/Workspace/presentations/views/AppShell.tsx`. The mastering page is a distinct layout, not a panel within the arrangement view.

**Mastering page layout:**
- **Track list** (left): imported mix files as mastering tracks (audio-only, no MIDI)
- **Device chain** (center): Proof instance per track for mastering processing
- **Metering** (right): LUFS integrated/momentary/short-term, true peak, loudness range — reuse existing `LUFSMeter` and `PhaseCorrelationDisplay` components from `src/modules/Workspace/presentations/components/`
- **Target presets** (top bar): dropdown selecting the delivery target, which auto-adjusts the LUFS target line in the meter display

**Mix session link** — each mastering track stores a `sourceProjectPath?: string` pointing to the mix session's `.sourdaw` file. Double-clicking the track opens that project in a new window via Tauri's multi-window support (`tauri::WebviewWindowBuilder`).

**Export integration** — extend `ExportDialog.tsx` at `src/modules/Project/presentations/views/ExportDialog.tsx` with a "Mastering Export" mode that renders all mastering tracks with their chains, normalizes to the target LUFS, and exports in the selected format(s) simultaneously.

**Do NOT create a separate module for mastering.** It's a workspace view mode that composes existing modules (Arrangement for tracks, Proof for processing, AudioAnalysis for metering, Project for export).

---

## 13. Delivery manager with platform-aware export

### Current state

Export dialog supports WAV/MP3/FLAC with sample rate and bit depth options. Stem export exists. No platform-specific presets.

### What to build

Select delivery targets and auto-generate compliant exports:

| Target | Format | Loudness | Sample Rate | Notes |
|--------|--------|----------|-------------|-------|
| Spotify | WAV/FLAC | -14 LUFS | 44.1kHz | 16/24-bit |
| Apple Music | WAV | -16 LUFS | 44.1-96kHz | Apple Digital Masters |
| YouTube | WAV | -14 LUFS | 48kHz | Stereo |
| Podcast | MP3 128kbps | -16 LUFS | 44.1kHz | Mono, ID3 metadata |
| Game Audio | WAV | varies | 48kHz | Per-asset naming |

### Implementation guidance

The export dialog at `src/modules/Project/presentations/views/ExportDialog.tsx` already supports WAV/MP3/FLAC format selection, sample rate (44.1/48/88.2/96 kHz), and bit depth (16/24/32). LUFS measurement exists in `src/modules/AudioAnalysis/useCases/` (momentary, short-term, integrated). Normalization exists in `src/modules/Arrangement/useCases/clip/normalizeClip.ts` with peak/RMS/LUFS modes.

**Add a delivery presets section** to the export dialog:
- Model: `type DeliveryPreset = { name: string; format: 'wav' | 'mp3' | 'flac'; sampleRate: number; bitDepth: number; channels: 1 | 2; targetLufs: number; normalize: boolean; metadata?: Record<string, string> }`
- Factory presets as a const array in `src/modules/Project/models/` (see the table in the spec above)
- UI: a horizontal row of preset buttons above the existing format controls. Selecting a preset auto-fills all fields. User can still override individual settings.
- Multi-target: checkboxes to export multiple targets simultaneously. Renders once, post-processes to each target format (resampling via existing `rubato` integration if sample rates differ, LUFS normalization per target).

**Metadata** — for podcast export, add basic ID3 tag fields (title, artist, description) to the export dialog. Use the `id3` or `lofty` Rust crate for tag writing in the Tauri backend.

---

## 14. AI-assisted comping

### Current state

Comping works — take lanes, swipe selection, crossfades, group comping across tracks. No AI involvement.

### What to build

AI that scores each take segment by pitch accuracy, timing alignment, and tonal consistency, then auto-generates a suggested "best comp." Users can weight criteria (prefer emotional intensity for ballads, timing precision for metal).

### Implementation guidance

Comping infrastructure is in `src/modules/Arrangement/useCases/`:
- `resolveComping.ts` — resolves active comp regions into `ResolvedClip[]`
- `groupComping/` — multi-track group comping with crossfade support
- Take management: `addTake.ts`, `selectTake.ts`, `TakeLane.ts` model

Pitch detection exists: `crates/daw-dsp/src/crumbs/analysis/pitch.rs` (Rust) and the `pitch-detection` crate. Onset detection exists: `crates/daw-dsp/src/crumbs/analysis/onset.rs`. The Knead module (`src/modules/Knead/`) does pitch analysis for correction — its analysis pipeline is reusable.

**Scoring algorithm** — create `src/modules/Arrangement/useCases/comping/suggestBestComp.ts`:
1. For each take in each take lane, analyze the audio:
   - Pitch accuracy: use Knead's pitch detection pipeline to compare detected pitch against the expected grid/scale degrees. Score = percentage of frames within ±50 cents of target.
   - Timing accuracy: use onset detection to find note attacks, compare against grid positions. Score = average deviation in milliseconds.
   - Energy/clarity: RMS energy profile consistency.
2. For each region boundary (e.g., bar boundaries), pick the take with the highest weighted score.
3. Output the suggested comp as a set of `CompRegion` entries that can be applied via the existing comping system.

**UI** — add a "Suggest Best Comp" button to `src/modules/Workspace/presentations/components/Inspector/TakesSection.tsx`. The result appears as a preview comp (highlighted differently from user-created comps) that the user can accept, modify, or dismiss. Provide sliders for weight adjustment: "Pitch accuracy" vs "Timing precision" vs "Energy" so users can bias the algorithm for different musical contexts.

**Scope decision**: analyze audio takes only (not MIDI — MIDI comping is trivial since notes are already discrete and quantizable). The analysis runs on a background thread via the Rust backend (`tokio::spawn_blocking`) to avoid blocking the UI.

---

## 15. AI UX philosophy — integration patterns

### The trust formula

Every AI feature must satisfy four conditions simultaneously:

**Transparency** — show every module and setting the AI chose. If AI applies EQ, show the curve. If AI adjusts levels, show gain changes numerically. Never apply processing without visual representation.

**Control** — three tiers: (1) macro view with single intensity slider + accept/reject, (2) module view with individual parameters, (3) full manual edit. Default AI intensity to **60-70%**, not 100%.

**Relevance** — detect or let user specify genre/style. Use reference tracks as the primary mechanism for defining sonic targets.

**Reversibility** — all AI operations create undoable entries. Destructive operations create new clips/tracks rather than modifying originals.

### The "learn" button pattern

Press record, AI analyzes during playback, generates result. Requires minimum 4 seconds of audio. Post-learning, result appears immediately but is not committed until user confirms. Works for EQ, mastering, dynamics, any spectral processing.

### Ghost clips for AI suggestions

AI-generated suggestions appear at 40% opacity with a subtle colored border and AI indicator icon. Accept with Enter/double-click, dismiss with Escape. Ghost clips play on hover for quick audition.

### Where AI belongs in the UI

- **Always visible**: BPM/key detection in transport bar, spectrum analyzer, loudness metering
- **One-click (right-click)**: Stem separation, audio-to-MIDI, pitch correction, EQ learn
- **Dedicated panel (toggleable)**: Mastering assistant, reference matching, cross-channel analysis
- **Command palette (Cmd+K)**: Natural language for all AI features
- **Not a separate mode**: AI features accessible from existing UI surfaces

### What NOT to build

- Full song generation from text — legal risk, philosophical tension
- AI that auto-arranges without asking — violates "guides, not decides"
- Credit/token systems — creates anxiety, not creativity
- AI content vendor lock-in — all outputs must be standard audio/MIDI

---

## 16. Sidechain-aware stem export

### Current state

Stem export exists (`exportStems.ts`) but renders tracks in isolation, breaking sidechain relationships.

### What to build

A stem export engine that properly renders inter-track dependencies:
- Sidechain compression relationships maintained during export
- Send effects rendered with correct wet/dry per stem
- Bus processing applied correctly

### Implementation guidance

Stem export is in `src/modules/Arrangement/useCases/freezeBounce/exportStems.ts`. Offline rendering is in `renderOffline.ts` in the same directory. Sidechain routing is managed by `src/modules/Routing/` with `addSidechainRoute`/`removeSidechainRoute` use cases and sidechain relationship data stored on tracks.

**The problem**: `exportStems` renders each track in isolation via `renderOffline`. When track B has a sidechain compressor keyed from track A's output, the isolated render of track B has no sidechain input — the compressor receives silence.

**Solution** — modify the stem export pipeline:
1. Before rendering, build a dependency graph from sidechain routes. Query all sidechain relationships from the routing store.
2. Topologically sort tracks so sidechain sources render before their targets.
3. When rendering a track that has sidechain inputs, render its sidechain source tracks first (or concurrently if they're independent), then feed the rendered source audio into the sidechain input during the target track's offline render.
4. For send effects: render the send bus with its effect chain, then mix the wet signal back into each stem at the correct wet/dry ratio.

**Key file to modify**: `exportStems.ts` — replace the independent per-track render loop with a dependency-aware render sequence. The `buildDeviceChain` function already constructs the audio graph including sidechain connections — the offline renderer needs to honor these connections instead of rendering in isolation.

**Existing infrastructure**: `src/modules/Arrangement/services/getUpstreamSubgraph.ts` already computes upstream dependencies — it takes a `trackId`, all tracks, and all sidechain routes, then returns a `Set<string>` of upstream track IDs by traversing output routing, sends, and sidechain relationships. This is exactly the dependency graph needed for ordered stem rendering. Use it directly.

---

## 17. Game audio delivery (Wwise/FMOD export)

### Current state

No game audio export support.

### What to build

Export mode that generates middleware project structures from DAW session:
- Auto-create Wwise containers or FMOD events from session structure
- Per-asset naming conventions
- Metadata export for middleware import

This is a v2.0+ feature. Low priority but unique — no DAW currently does this.

---

## What NOT to overbuild

1. **Do not turn intent into project bureaucracy** — no giant object model with statuses, evidence references, and satisfaction scores
2. **Do not make provenance a mainstream headline** — it can support export/rights/disclosure workflows quietly
3. **Do not prioritize deep spatial architecture before the DAW wins at core production** — see `atmos.md` for when this is relevant
4. **Do not drown the product in side panels** — every panel must earn its existence by accelerating real work
5. **Do not let metadata outrun immediacy** — the DAW should feel fast, tactile, and musical

---

## Success criteria

Sourdaw is on the right path when:

1. Users create and manage alternates without duplicate-track mess
2. Expressive performance meaning survives edits and target changes
3. Rough ideas and notes live directly inside the session
4. AI actions are explicit, reversible, and branch-friendly
5. Users know exactly what render path and quality tier they're hearing
6. Projects adapt between browser and desktop without drift
7. Feature availability and fallback behavior are clearly explained
8. Richer instrument behavior is discovered when available without depending on it
9. The DAW stays fast and musical with all of the above in play
