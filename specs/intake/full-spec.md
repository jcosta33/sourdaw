---
type: intake
source: internal-consolidation
url: (none)
captured: 2026-06-13
---

# Intake: Consolidated Spec — Unimplemented Features & Differentiators

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

# Quick win — fix before anything else

## 0. Expression data loss on paste (bug fix)

**This is a data loss bug. Fix it independently before starting any feature work.**

`pasteNotes.ts` and `pasteClip.ts` strip `pressure`, `slide`, and `pitchBend` from copied notes by routing through `createMidiNote()` which only accepts 5 args. The clipboard correctly preserves all fields (via spread in `copySelectedNotes.ts`), but paste discards them.

**Fix in `src/modules/Arrangement/useCases/clipboard/pasteNotes.ts` line 24-25:**

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

**Same fix in `src/modules/Arrangement/useCases/clipboard/pasteClip.ts` line 50-51:**

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

**Test**: copy a note with pressure/slide/pitchBend set, paste it, verify the pasted note retains all expression fields. The existing `pasteNotes.spec.ts` and `pasteClip.spec.ts` need new assertions for expression preservation.

---

# Phase 1 — Real differentiators

### Build order within Phase 1

Items have dependencies — build in this order:

1. **Capability-aware feature planning (item 6)** — foundation for session modes and runtime transparency
2. **Hardware-adaptive session modes (item 5)** — depends on capability system
3. **Runtime transparency strip (item 2)** — depends on session modes and capability system
4. **Variation-native clips (item 1)** — independent, can start in parallel with items 5-6
5. **Trust modes for AI (item 3)** — depends on variants system (the "create branch" mode uses variants)
6. **Capture-anything project memory (item 4)** — independent, can start in parallel

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

**CRDT/collaboration** — the new `variantGroupId`, `variantLabel`, `variantSource`, and `variantCreatedAt` fields on `Clip` will be synced through Automerge via the existing `CrdtDocument` module (`src/modules/CrdtDocument/`). Since `Clip` is already part of the synced project document, adding optional fields is backward-compatible — older clients ignore unknown fields. Variant archives stored in `TrackAlternative` are also already part of the synced `Track` model. No new CRDT merge logic is needed — Automerge's JSON CRDT handles concurrent edits to these fields automatically. When a collaborator creates a variant, it appears as a new sibling in the other collaborator's variant list.

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

| Mode                       | Behavior                                           |
| -------------------------- | -------------------------------------------------- |
| **Suggest only**           | Show ghost clips/notes, no session changes         |
| **Create branch**          | Results go to a new variant, never touch mainline  |
| **Apply reversible delta** | Modify in place with full undo                     |
| **Replace selection**      | Overwrite selected content (requires confirmation) |
| **Destructive commit**     | Permanent change (e.g., bounce with AI processing) |
| **Analyze only**           | Read-only inspection, no output artifacts          |

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

| Mode             | Behavior                                                                              |
| ---------------- | ------------------------------------------------------------------------------------- |
| **Sketch**       | Minimal resources, fast startup, basic synths, no heavy DSP                           |
| **Preview**      | Standard quality, browser-compatible, lightweight effects                             |
| **Review**       | Playback-biased: all mixing/mastering chains engaged, editing responsiveness deferred |
| **Production**   | Full native DSP, all plugins loaded, highest quality, editing-biased                  |
| **Final render** | Offline, maximum quality, no real-time constraints                                    |

`Review` is the listening/approval mode: the user plays the session to judge it, not to edit it. Interactive editing latency can relax in exchange for running every processor (including otherwise-deferred tails, oversampling, and slower AI renderers).

Users can also choose a bias: preserve interactivity, prioritize quality, conserve power, background refine.

### Minimum quality bar

A project opened on a lightweight browser runtime stays editable and musically meaningful. The same project on desktop upgrades render quality without breaking continuity.

### Implementation guidance

**Do NOT create a new module.** Session modes are a cross-cutting concern, not a domain boundary. Implement as:

- `src/utils/sessionMode.ts` — a `Store<SessionModeState>` holding the current mode and computed fidelity info. Reads `platformCapabilities` and `capabilityDetector` on init. Subscribes to runtime changes (e.g., Tauri becoming available, WebGPU detection completing).
- `SessionModeState` type: `{ mode: 'sketch' | 'preview' | 'production' | 'final-render'; bias: 'interactivity' | 'quality' | 'power-save'; detectedCapabilities: PlatformCapabilities; effectiveConstraints: SessionConstraints }`.
- `SessionConstraints` type: `{ maxPolyphony: number; enableNativePlugins: boolean; renderQuality: RenderQuality; enableHeavyDSP: boolean }`.

**Integration points** (each module checks `sessionMode` and adapts):

- `BrowserAi` — `RenderQuality` already exists (`low`/`standard`/`high`/`maximum` in `src/modules/BrowserAi/models/RenderProgress.ts`). Map session modes: sketch→low, preview→standard, review→high, production→high, final-render→maximum. Review differs from production on the audio-engine side, not the render-quality side (see below).
- `AudioEngine` — adjust buffer sizes and voice counts. The Rust crates already support configurable buffer sizes via `cpal`.
- `Arrangement/useCases/freezeBounce/renderOffline.ts` — in final-render mode, use maximum quality settings (highest sample rate, longest reverb tails).

**Persistence** — add `sessionMode?: 'sketch' | 'preview' | 'review' | 'production' | 'final-render'` to `ProjectData` at `src/modules/Project/models/ProjectData.ts`. Default to auto-detection based on platform capabilities.

**UI** — add a mode selector to the transport bar or status bar. Five clear icons/labels. No complex settings — just the mode and an optional bias preference stored in user preferences.

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

**Known bug (fix is item 0 above)**: `pasteNotes.ts` and `pasteClip.ts` strip expression data on paste. Fix that first.

### What to build

Build a **Performance Editor** layer on top of the fixed paste infrastructure:

- Copy notes only / copy expression only / copy notes+expression
- Transfer feel from one phrase to another (extend existing groove extraction)
- Visual overlays showing timing heat, dynamic contour, pitch drift, pressure shape
- When moving material between richer and poorer targets (e.g., MPE synth to basic MIDI), show a **Portability Report**: preserved / approximated / downgraded / unavailable

### Preserved dimensions

The internal model should carry (and the Performance Editor should let the user see/edit) these dimensions per note or per phrase — not as a wall of CC lanes, but as a small set of named axes:

- **Timing feel**: microtiming deviation from grid (per-note)
- **Dynamic contour**: velocity and pressure envelope across a phrase
- **Accent profile**: which notes carry emphasis within a phrase
- **Vibrato behavior**: rate and depth derived from pitchBend oscillation
- **Pitch drift**: non-vibrato pitchBend envelope (expressive glide)
- **Onset character**: attack shape (derived from velocity + early pressure)
- **Sustain character**: mid-note pressure/slide behavior
- **Release character**: end-of-note pressure taper
- **Timbral bias**: slide/CC-74 trajectory (brightness bias)
- **Phrase energy**: aggregate of contour + accent, phrase-scoped
- **Note role in texture**: melodic / harmonic / rhythmic / ornament (user-assignable, optional)

The first nine are computed from existing `MidiNote.{velocity, pressure, slide, pitchBend}` and note timing — no new per-note fields are required. "Phrase energy" and "note role" are new phrase-scoped metadata (see synchronized views below).

### Synchronized views: note / phrase / lane

Today the piano roll (`src/modules/Workspace/presentations/views/ClipView/PianoRoll.tsx`) is a single canvas rendered by `usePianoRollRenderer.ts`. Expression lanes (`src/modules/Workspace/presentations/views/AutomationLane/{VelocityLane,PressureLane,SlideLane,PitchBendLane}.tsx`) live in a `NotePropertyLane` panel that shows **one lane at a time**, toggled from `PianoRollToolbar.tsx`. There is no phrase concept between the clip and the note.

Add a **view-mode selector** to `PianoRollToolbar.tsx` with three modes:

| Mode       | Layout                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Note**   | Current behavior — single canvas, optional single lane below                                                                                    |
| **Phrase** | Left sidebar: phrase list (name, color, energy). Main canvas: piano roll with phrase-bounded background bands. Phrase-level drag/select.        |
| **Lane**   | Main canvas: notes at top (shorter). Below: **all** expression lanes stacked (velocity, pressure, slide, pitchBend, CC). Vertically scrollable. |

All three views share:

- `selectedNoteIds` (existing, from `midiStore`)
- New `selectedPhraseIds: Set<string>` in `midiStore` (or a sibling `phraseStore`)
- `beatWidth` / scroll position — synchronized across every lane and the main canvas so horizontal position stays consistent

**Data model — add `Phrase` to the Clip**:

Define in `src/modules/MIDI/models/Phrase.ts`:

```typescript
type Phrase = {
    id: string;
    clipId: string;
    name: string; // user-editable ("verse hook", "lick A")
    startBeat: number;
    endBeat: number;
    color?: string; // hex, inherits from clip if unset
    noteIds: string[]; // references MidiNote.id, not copies
    role?: 'melodic' | 'harmonic' | 'rhythmic' | 'ornament';
    energyHint?: number; // 0-1, user-set or auto-computed
};
```

Store phrases in `midiStore` alongside notes: `phrasesByClipId: Record<string, Phrase[]>`. Phrases are computed-augmentation on top of notes — deleting a note removes its id from any phrase; deleting a phrase never deletes its notes.

**Lane-view rendering** — reuse the existing lane components (`VelocityLane`, `PressureLane`, `SlideLane`, `PitchBendLane`) as stacked children instead of swapped-in singletons. Each lane already reads from `midiStore` via reference equality and handles its own drag-edit. The lane-view container in `ClipView/` just needs to render them all at once, height-sized by a resizable splitter.

**Phrase-view rendering** — extend `usePianoRollRenderer.ts` to paint phrase background bands before notes (use phrase color at low alpha). Add a separate left sidebar component `PhraseListSidebar.tsx` listing phrases with inline rename/color pick.

**Selection synchronization** — when the user clicks a phrase in the sidebar, select all its `noteIds` in `midiStore`. When the user draws a note inside a phrase's beat range in Note view, optionally add it to that phrase (default: yes, togglable from toolbar).

**Groove extraction already exists** at `src/modules/MIDI/useCases/grooveExtraction/extractGrooveFromClip.ts` and returns a `GrooveTemplate`. Extend with `extractGrooveFromPhrase.ts` (phrase-scoped) and an **"apply feel"** action that transfers timing + velocity profile from one phrase to another. The existing groove store handles templating; no new infrastructure needed.

### Portability mapping — strategies and fallback projections

When expression moves across target boundaries (synth → plugin, MPE-capable → non-MPE, internal → external MIDI out), the user picks a **mapping strategy** and the system applies **fallback projections**. Both must be explicit — no silent downgrade.

**Four strategies** (user-visible, per-track default + per-paste override):

| Strategy                | Behavior                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `literal`               | Only send what the target natively supports. Drop the rest. No approximation.                                             |
| `expressive-equivalent` | Approximate unsupported expression using the target's closest equivalent (e.g., per-note pitch → MPE channel pitch bend). |
| `conservative`          | Only send expression the system is certain the target renders correctly (intersection of declared capability). Safest.    |
| `target-optimized`      | Use the target's native strengths — if the plugin maps CC11 to expression, route pressure → CC11. Best audible result.    |

**Three fallback projections** (applied as building blocks by the strategies):

1. **Per-note pitch → channel allocation** — when the target does not support CLAP note-expression pitch but does support MPE, allocate one channel per active note (standard MPE channel rotation) and emit channel pitch bend. Needs: track-level "max simultaneous notes" hint to avoid exhausting the MPE zone.
2. **Per-note timbre → automation** — when the target has no per-note modulation, project `pressure` / `slide` to a track-level CC lane (CC11 for pressure, CC74 for slide by default, configurable). Write to the existing automation layer.
3. **Rich curves → engine-native bundles** — for built-in instruments (Fermenter, GrandBoule) that accept native parameter bundles, pack pressure + slide + pitchBend into a single `MpeParams` object (already declared in `builtinSynth.ts` line 94) instead of splitting into MIDI events.

**Implementation location** — create `src/modules/MIDI/services/portabilityMapper.ts` (the MIDI module owns expression semantics):

```typescript
export type OutputStrategy = 'literal' | 'expressive-equivalent' | 'conservative' | 'target-optimized';

export type TargetCapabilities = {
    supportsMpe: boolean;
    supportsPerNotePitchBend: boolean;
    supportsPerNotePressure: boolean;
    supportsPerNoteSlide: boolean;
    hasCC11Expression: boolean;
    supportsChannelPressure: boolean;
    expressionTier: 'basic' | 'extended' | 'full-mpe'; // matches DeviceCapabilities from item 8
};

export type ProjectedNote = {
    pitch: number;
    velocity: number;
    channel: number; // MPE channel allocation output
    startBeat: number;
    duration: number;
    projectedCCs?: Array<{ controller: number; value: number; beat: number }>;
    projectedChannelPressure?: number;
    projectedPitchBend?: number;
    mpeChannelHint?: number;
};

export type PortabilityResult = {
    projected: ProjectedNote[];
    report: {
        preserved: string[]; // e.g., ["velocity", "pitch bend"]
        approximated: string[]; // e.g., ["pressure → CC11"]
        dropped: string[]; // e.g., ["slide"]
    };
};

export function queryTargetCapabilities(device: Device, clapMetadata?: ClapCapabilityMap): TargetCapabilities;

export function projectExpression(
    notes: MidiNote[],
    strategy: OutputStrategy,
    capabilities: TargetCapabilities
): PortabilityResult;
```

**Integration points** (three places, all existing files):

1. **Clipboard paste** — after the item-0 paste bug fix, `src/modules/Arrangement/useCases/clipboard/pasteNotes.ts` still blindly pastes full expression. Extend it to call `queryTargetCapabilities(targetDevice)` and `projectExpression(notes, strategy, caps)`. The `PortabilityResult.report` feeds the portability-report toast.
2. **Scheduling dispatch** — `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts` around line 471 already extracts `mpe` fields but does not yet apply them for worklet synths. Route through `projectExpression` before dispatch so the synth receives strategy-correct values.
3. **CLAP capability discovery** — `crates/daw-plugin-host/src/clap_wrapper.rs` queries `CLAP_EXT_PARAMS`; also query `CLAP_EXT_NOTE_EXPRESSION` and expose which expression types (pitch, volume, pan, tuning, vibrato, expression, brightness, pressure) the plugin declares. Surface into the frontend as `ClapCapabilityMap` on the device descriptor.

**Per-track override** — add `midiOutputStrategy?: OutputStrategy` to the track model (`src/modules/Arrangement/models/Track.ts`). Default at runtime: `expressive-equivalent`. The per-paste UI override writes the chosen strategy once, then reverts.

**UI** — the portability report appears as a lightweight toast after a paste that triggered any approximation or drop, with an "undo paste" action. The strategy selector lives in the paste context menu (not the main toolbar) and as a track-inspector field.

### Minimum quality bar

A phrase recorded with rich expression is editable semantically, copied with feel intact, moved to a less expressive target with an honest portability report showing which projection strategy was applied and what was preserved / approximated / dropped.

### Implementation guidance

The paste bug fix is item 0 above — do that first. Once expression data survives paste, build these features:

**Expression clipboard modes** — add to `src/modules/Arrangement/useCases/clipboard/`:

- `pasteExpressionOnly.ts` — paste `pressure`, `slide`, `pitchBend`, `velocity` from clipboard notes onto matching notes in the target clip (match by relative position/pitch)
- `pasteNotesWithoutExpression.ts` — paste notes but reset expression fields to defaults

**Performance overlays** — extend the piano roll renderer at `src/modules/Workspace/presentations/hooks/usePianoRollRenderer.ts` with optional overlays:

- Timing heat: color notes by deviation from grid (green = on grid, orange = early, blue = late)
- Dynamic contour: thin line connecting velocity values across the phrase
- These are visualization modes, toggled in the piano roll toolbar

**Portability report** — implemented as `PortabilityResult.report` from `src/modules/MIDI/services/portabilityMapper.ts` (see the full mapper spec above). Shown as a lightweight toast after paste, with clickable details: which strategy ran, what was preserved, approximated, dropped — plus an "undo paste" button.

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

### Adopt-detected-semantics flow

Discovery should never silently reconfigure the session. When a device declares capabilities (either from static registration or live CLAP/plugin discovery), show a non-blocking **Adopt Semantics** prompt once per device instance:

> "Fermenter reports full-MPE support with per-note pressure, slide, and pitch-bend. Adopt these editor settings? **[Adopt] [Keep current] [Never for this device]**"

**Adopt** enables the matching expression lanes, sets track MPE on, and switches the piano roll to the recommended lane-view profile. **Keep current** leaves the track unchanged but remembers the device's declared capabilities for portability (portability mapping still uses them — only the UI is untouched). **Never for this device** persists a per-device opt-out in user preferences.

**Implementation**:

- Store the suggestion state in a `deviceSemanticsStore` (`src/modules/Arrangement/stores/`) with shape `{ suggestionsByDeviceInstanceId: Record<string, 'pending' | 'adopted' | 'declined' | 'never'> }`
- Trigger suggestion on device load (existing `loadDevice.ts` flow in Arrangement useCases) when `DeviceCapabilities` differs from the track's current expression setup
- Override is always available — a manual "Apply detected semantics" action in the track inspector re-runs the adopt flow on demand
- If capability discovery fails or returns nothing, silently degrade to generic control with no prompt — match the differentiator's requirement that failed discovery must not confuse the user

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

| Target      | Format      | Loudness | Sample Rate | Notes                 |
| ----------- | ----------- | -------- | ----------- | --------------------- |
| Spotify     | WAV/FLAC    | -14 LUFS | 44.1kHz     | 16/24-bit             |
| Apple Music | WAV         | -16 LUFS | 44.1-96kHz  | Apple Digital Masters |
| YouTube     | WAV         | -14 LUFS | 48kHz       | Stereo                |
| Podcast     | MP3 128kbps | -16 LUFS | 44.1kHz     | Mono, ID3 metadata    |
| Game Audio  | WAV         | varies   | 48kHz       | Per-asset naming      |

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

No game audio export support. The existing stem export (`exportStems.ts`) and DAWproject export (`dawProjectUseCases.ts`) provide the closest foundation.

### What to build

Export mode that generates middleware project structures from a DAW session:

- Map arrangement sections/markers to Wwise containers or FMOD events
- Per-asset naming conventions (e.g., `sfx_footstep_wood_01.wav`) with configurable templates
- Metadata export (loop points, volume, priority) as Wwise `.wwu` XML or FMOD bank metadata
- Batch render regions between markers as individual assets with silence-trimmed heads/tails

### Implementation guidance

- Add a "Game Audio Export" tab to the export dialog
- Use the existing marker/section system to define asset boundaries — each section becomes one exported asset
- Naming template: `{section}_{track}_{index}.wav` with user-customizable pattern
- Wwise XML format is documented publicly; FMOD Studio API has a scripting interface
- Start with flat WAV export with naming conventions (immediately useful). Add Wwise/FMOD project generation as a follow-up.

This is a v2.0+ feature. Low priority but unique — no DAW currently does this.

---

## 18. ML-based transient detection

### Current state

Onset detection exists in `crates/daw-dsp/src/crumbs/analysis/onset.rs` using spectral flux, HFC, and complex domain algorithms. These are traditional DSP methods achieving ~90% accuracy. The `audioToMidi.ts` use case in Arrangement uses spectral flux for audio-to-MIDI conversion. No ML-based detector exists.

### What to build

A CNN-based onset detector achieving **94%+ accuracy** that handles soft onsets and polyphonic material far better than spectral flux. This feeds:

- Snap-to-transient navigation
- Audio quantization (elastic audio, which exists at `elasticAudioUseCases.ts`)
- Beat slicing for the Crumbs/Slicer instruments
- More accurate audio-to-MIDI conversion

### Implementation guidance

- Use a small ONNX model (~5-10 MB) for onset detection, run via the existing `ort` crate in `src-tauri/`
- The model processes mel-spectrogram frames and outputs onset probability per frame
- Expose as a Tauri command `detect_onsets_ml` returning `Vec<OnsetEvent>` with frame position and confidence
- Fall back to spectral flux on platforms without ONNX support (browser without Tauri)
- Open-source onset detection models exist (e.g., madmom-based, trained on standard datasets)
- Wire the output into the existing `elasticAudioUseCases.ts` and `audioToMidi.ts` as an alternative detector

---

## 19. AI warp mode auto-detection

### Current state

Audio warping supports 9 algorithms (`audioWarpingUseCases.ts`): elastique Pro/Efficient/Soloist, Rubber Band R3/RT, Complex/Pro, Re-Pitch, Slice. Users must manually select the appropriate mode.

### What to build

AI that analyzes audio content and auto-selects the optimal warp mode:

- Drums/percussive → Beats/Slice mode
- Vocals/monophonic → Soloist/Re-Pitch mode
- Complex polyphonic → Complex Pro mode
- Textures/pads → Texture mode

### Implementation guidance

- Create `src/modules/Arrangement/useCases/audioWarp/autoDetectWarpMode.ts`
- Use spectral analysis (spectral centroid variance, onset density, harmonic-to-noise ratio) to classify material type — this can be pure DSP, no ML model needed
- The classification feeds into the existing `setWarpAlgorithm.ts` use case
- Run analysis on a short segment (2-4 seconds) when audio is first imported or when the user enables warping
- Show the detected mode as a suggestion the user can accept or override

---

## 20. Non-destructive Direct Offline Processing (DOP)

### Current state

Offline processing exists via `renderOffline.ts` for freeze/bounce operations. These are destructive — they render to a new audio file replacing the original content.

### What to build

Cubase-style DOP where offline effect operations stack non-destructively:

- Apply a plugin to a region → operation is recorded, not baked
- Change settings, remove, or reorder operations after the fact
- Each operation stores its plugin state and affected region
- Only renders when needed (lazy evaluation)

### Implementation guidance

- Add a `dopStack?: DopOperation[]` field to the `Clip` type in `Track.ts`
- `DopOperation` type: `{ id: string; pluginType: string; parameterValues: Record<string, number>; startBeat: number; endBeat: number; enabled: boolean; order: number }`
- The playback scheduler checks for DOP operations and renders them on-the-fly or caches the result
- UI: show the DOP stack in the clip inspector with reorder handles and enable/disable toggles
- This is a significant feature — scope it as Phase 2+ work, not an immediate build

---

## 21. Engine visibility, swappability, and A/B comparison

### Current state

Three independent engine systems exist; none of them are visible to the user beyond a read-only badge, and none are swappable mid-session.

1. **LLM backend cascade** — `src/modules/AiRuntime/useCases/llmOrchestration/backendResolution/helpers.ts` resolves `native` → `webllm` → `cloud` → `none` via `resolveBackend()`. `src/modules/Workspace/presentations/views/preferences/AiSection.tsx` shows the active backend as a colored badge (green / cyan / lavender / gray) and lets the user enter an API key, but there is no toggle to switch backends or see the full fallback chain.
2. **Browser AI render pipelines** — `src/modules/BrowserAi/stores/renderQueueStore.ts` dispatches to `ddsp`, `kokoro`, and `diffsinger` engines. `RenderProvenance` (`src/modules/BrowserAi/models/RenderProgress.ts:44–53`) records `modelId`, `voiceId`, `steps`, `seed`, `renderQuality`, `renderedAt`, and a coarse `tier: 'browser-preview' | 'native-final'`, but **no engine identity string**.
3. **Audio engine / freeze state** — `FreezeState` (`src/modules/Arrangement/models/Track.ts:15–31`) tracks `sourceContentHash`, `deviceChainHash`, `frozenBufferId`, and `renderSettings`, but **no record of which engine produced the frozen audio**.

Nothing lets the user compare two engines' output on the same phrase.

### What to build

A three-phase rollout of engine visibility → swappability → comparison.

### Phase A: engine identity on every rendered artifact

Add an `engine` field to every render-provenance record so the UI can surface it.

**`RenderProvenance`** (`src/modules/BrowserAi/models/RenderProgress.ts`) — add:

```typescript
engine: string;            // e.g., "ddsp-browser", "diffsinger-voicebank:en-f01", "native-piano"
fallbackUsed: boolean;     // true if primary engine was unavailable
fallbackReason?: string;   // e.g., "WebGPU tier insufficient", "native host not loaded"
```

**`FreezeState`** (`src/modules/Arrangement/models/Track.ts`) — add the same three fields under a new `renderedBy` sub-object so frozen audio declares which engine produced it.

**`ClipData`** (`src/modules/Arrangement/models/Track.ts`, the `Clip` type around line 74) — add optional `renderedBy?: { engine: string; fallbackUsed: boolean; fallbackReason?: string }` for AI-generated clips. Populated by the use cases that create AI clips (`generateMidiVariations.ts`, `acceptGhostClip.ts`, any `BrowserAi` render result that lands on the timeline).

### Phase B: runtime strip engine segment + swap

Extend the runtime transparency strip (item 2) with an **engine chain segment**:

- Show the active engine per subsystem: `LLM: native` / `AI render: ddsp-browser` / `DSP: native-rust`
- Click a segment → dropdown listing the full fallback chain, with the reason each tier was chosen or skipped (reads from `resolveBackend()` telemetry)
- **Swap action**: clicking a non-active tier in the dropdown calls a new `swapEngine(subsystem, target)` use case that reruns `resolveBackend` with a forced override, updates `llmStatusStore` / `capabilityStore`, and triggers re-resolution on the next inference call

**Swap use case** — create `src/modules/AiRuntime/useCases/llmOrchestration/swapBackend.ts`:

```typescript
export function swapBackend(target: 'native' | 'webllm' | 'cloud' | 'none'): Result<void, BackendError>;
```

Enforces: swap is allowed only when target is available (checked via existing capability detection); in-flight inference requests abort cleanly; the swap is recorded in `actionHistoryStore` so undo works.

**Context preservation** — engine swap must not disturb the session. Explicit invariants to test:

- MIDI notes (pitch, timing, `velocity`, `pressure`, `slide`, `pitchBend`) unchanged across swap
- Clip-level metadata (`variantGroupId`, `renderedBy`) unchanged
- Automation curves and track routing unchanged
- Frozen audio buffers retained (not re-rendered) — `frozenBufferId` stable

### Phase C: A/B engine comparison (variants-based)

Once Phase A + B land and the variants system (item 1) is in place, engine comparison is a composition, not new infrastructure:

1. User invokes "Re-render with engine X" from a clip's context menu
2. The re-render lands in a **new variant** (never overwrites mainline), tagged `variantSource: 'ai'` and `renderedBy.engine = 'X'`
3. Variant panel (item 1 UI) shows engine identity next to each variant — user auditions A vs B in place
4. Promote or archive as normal

No separate "A/B panel" — comparison reuses the variant compare/audition flow.

### Minimum quality bar

The user can (1) see which engine produced every frozen buffer, AI-generated clip, and LLM response; (2) swap the LLM backend mid-session without losing any MIDI, expression, or audio state; (3) render the same phrase with two engines and audition them in place as variants.

### What this is not

Not an "engine rack" philosophy. The runtime strip shows the **active chain in one line**, not a dashboard. Advanced users get the swap menu; casual users never see it unless they click the segment.

---

## 22. Export-oriented provenance

### Current state

Export pipeline: `src/modules/Project/presentations/views/ExportDialog.tsx` → `src/modules/Project/useCases/exportActions.ts` → `src/modules/AudioEngine/useCases/exportStems.ts` (stems) or offline-render use cases (mixdown). Project file export: `src/modules/Project/useCases/projectPersistence/fileIO/exportProjectFile.ts` bundles metadata and audio buffers into `.sourdaw`.

No exported file carries provenance metadata. Clips and notes have no `sourceOrigin` field. AI action history (`aiActionHistoryStore`) tracks prompts and timestamps but does not link to the clip/note IDs they created.

### What to build

A **silent, export-time provenance report** — not a mainstream UI feature. Used by label legal teams, competition submissions, and rights workflows. Zero UI during normal export.

### Data model

Extend **`Clip`** (`src/modules/Arrangement/models/Track.ts`) and **`MidiNote`** (`src/modules/MIDI/models/MidiNote.ts`) each with one optional field:

```typescript
sourceOrigin?: 'recorded' | 'imported' | 'ai-generated' | 'sample-library' | 'ai-transformed';
```

Populated at creation time:

- Recording use cases → `'recorded'`
- Audio/MIDI import use cases → `'imported'`
- `acceptGhostClip.ts`, `generateMidiVariations.ts`, any BrowserAi use case that writes a clip → `'ai-generated'`
- Levain/Toaster sample-library loaders (`autoLoadLevainSamples`, drum-pack import) → `'sample-library'`
- Destructive AI transforms (bounce with AI processing, see trust mode `destructive-commit` in item 3) → `'ai-transformed'`

When a clip has mixed origin (e.g., recorded notes edited by AI), `sourceOrigin` is the **most recent** origin; the original origin is preserved in variants via the existing variants system (item 1 — the pre-edit state stays in `TrackAlternative`).

### Report generation

Create `src/modules/Project/useCases/exportProvenance.ts`:

```typescript
export type ProvenanceReport = {
    exportedAt: number;
    projectName: string;
    summary: {
        recordedDurationSeconds: number;
        aiGeneratedClips: number;
        aiTransformedClips: number;
        sampleLibrarySources: string[]; // deduplicated source identifiers
        importedAudioFiles: number;
    };
    clips: Array<{
        id: string;
        name: string;
        trackId: string;
        sourceOrigin: string;
        renderedBy?: { engine: string; fallbackUsed: boolean }; // from item 21
        generatedBy?: string; // model or library identifier
    }>;
};

export function generateProvenanceReport(project: ProjectData): ProvenanceReport;
```

Pure function over project data — no side effects, no UI. Walks tracks/clips/notes, aggregates by `sourceOrigin`, returns the shape above.

### Attachment points

1. **Project file** — extend `ProjectData` (`src/modules/Project/models/ProjectData.ts`) with `provenanceReport?: ProvenanceReport`. `exportProjectFile.ts` calls `generateProvenanceReport()` before serialization.
2. **Audio export (Tauri)** — write sidecar `<filename>.provenance.json` via existing `writeFile` Tauri command. Extend `exportActions.ts` after successful render.
3. **Audio export (web)** — when exporting as `.zip` (multi-format or stems), include `provenance.json` in the archive. Extend the existing `zipDirectory` logic in `ExportDialog.tsx`.
4. **ID3 metadata** (optional, podcast-profile only) — the podcast delivery preset (item 13) can embed a compact provenance summary in ID3 `TXXX` frames via the `lofty` Rust crate. Field: `TXXX:SourdawProvenance` = JSON-stringified summary only.

### UI footprint

**Zero** during normal export. One small checkbox in the export dialog: `[ ] Include provenance report` (default: on for project file, off for audio export). Clicking "Learn more" shows a one-paragraph explainer.

### Minimum quality bar

Exporting a project with mixed recorded + AI-generated + sample-library content produces a `provenance.json` that correctly classifies every clip. A compliance reviewer can audit the file without opening the DAW. No user ever sees a provenance UI they did not ask for.

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

---

## Acceptance criteria

Testable gates for each feature. A feature is not done until its criteria pass.

### Quick win

- [ ] **AC-0.1:** Paste a MIDI note with pressure=80, slide=64, pitchBend=8192 set. The pasted note retains all three values.
- [ ] **AC-0.2:** Paste a clip containing expressive notes. All expression fields survive the paste.

### Phase 1

- [ ] **AC-1.1:** Create 3 variants of a clip. Audition each in place without duplicating tracks. Promote one. Archived variants remain accessible.
- [ ] **AC-2.1:** StatusBar shows runtime class (browser/native/hybrid) and fidelity tier. Fallback explanations are visible on click.
- [ ] **AC-3.1:** AI generation creates a ghost clip (suggest-only mode). Accepting it commits to the timeline. Dismissing it leaves no trace.
- [ ] **AC-3.2:** AI generation in create-branch mode produces a variant, never overwrites the active clip.
- [ ] **AC-4.1:** Record a voice note, attach it to bars 17-21, search for "hit harder", find the memo, jump to the timeline range.
- [ ] **AC-5.1:** Same project opens in browser (preview mode) and desktop (production mode) without manual reconfiguration.
- [ ] **AC-6.1:** Disabled features show a tooltip explaining why ("native plugin hosting unavailable in browser mode").

### Phase 2

- [ ] **AC-7.1:** Copy an expressive phrase, paste onto a basic-MIDI instrument. A portability report shows which expression was dropped.
- [ ] **AC-7.2:** Switch the piano roll to Lane view. All five expression lanes (velocity, pressure, slide, pitchBend, CC) render stacked and share horizontal scroll/selection with the note canvas.
- [ ] **AC-7.3:** Switch to Phrase view, create two phrases in a clip, use "apply feel" to transfer the first phrase's groove onto the second. The second phrase's timing now matches the first's microtiming profile.
- [ ] **AC-7.4:** Paste with `conservative` strategy onto a plugin with unknown note-expression support. Only velocity and pitch are sent — the report lists `pressure`, `slide`, `pitchBend` as dropped.
- [ ] **AC-7.5:** Paste with `target-optimized` strategy onto a plugin that declares CC11 expression. `pressure` is routed to CC11 and the report lists it as `approximated: pressure → CC11`.
- [ ] **AC-8.1:** Loading a Fermenter instance auto-detects MPE support. The piano roll shows pressure/slide lanes. Loading a Toaster hides them and shows drum-pad view.
- [ ] **AC-8.2:** Loading a new Fermenter triggers the Adopt Semantics prompt. Choosing "Never for this device" suppresses the prompt on subsequent loads of the same device instance.

### Standalone

- [ ] **AC-14.1:** AI comping scores 3 overlapping takes and suggests a comp. The suggestion is auditionable before committing.
- [ ] **AC-16.1:** Sidechain-aware stem export of a kick-sidechained bass produces a bass stem with audible pumping intact.
- [ ] **AC-18.1:** ML transient detector places markers on a drum break with >94% precision vs manually marked ground truth.
- [ ] **AC-19.1:** Auto-detect correctly classifies a drum loop as "Beats" mode and a vocal as "Soloist" mode.
- [ ] **AC-20.1:** Apply two DOP operations to a clip. Reorder them. Remove the first. Audio reflects the change without re-rendering from scratch.
- [ ] **AC-21.1:** Every frozen buffer, AI-generated clip, and LLM response displays its producing engine in the runtime strip on click.
- [ ] **AC-21.2:** Swap LLM backend from `cloud` to `webllm` mid-session. No MIDI, expression, variant, or frozen-buffer state is lost; the next inference runs on webllm.
- [ ] **AC-21.3:** Re-render the same clip with engine A, then with engine B. Both results appear as variants on the same clip with distinct `renderedBy.engine` values. Audition switches between them in place.
- [ ] **AC-22.1:** Export a project containing recorded, AI-generated, and sample-library clips. The `provenance.json` sidecar (or embedded field) classifies every clip correctly, with per-clip `renderedBy` where applicable.
- [ ] **AC-22.2:** A destructive AI transform on a previously-recorded clip sets `sourceOrigin: 'ai-transformed'` while preserving the pre-transform variant with `sourceOrigin: 'recorded'` in the variant archive.

### Global

- [ ] **AC-G.1:** `pnpm deps:validate` passes with zero new violations after each feature lands.
- [ ] **AC-G.2:** All existing tests continue to pass (`npx vitest run`).
