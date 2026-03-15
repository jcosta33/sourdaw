# AI-Native DAW — UI/UX Product Specification

## Role of this document

This is the **product and UX specification**. It defines what the app looks like, how users interact with it, and what features it must have.

For technical architecture, AI system design, and technology stack, see **`.agents/tasks/research.md`**.

For the implementation plan and setup instructions, see **`.agents/tasks/task.md`**.

---

# 1. Product Principles

## Primary Goals

1. **Immediate usability** — works without reading a manual
2. **Minimal cognitive load** — no clutter, no floating window sprawl
3. **Maximum editing speed** — common operations are fast and direct
4. **AI augmentation without disruption** — AI assists, never blocks
5. **All actions reversible** — full undo including AI operations
6. **Everything discoverable** — via prompt, palette, right-click, or shortcut

---

# 2. Interaction Model

The DAW supports **three simultaneous interaction methods**:

| Method          | Purpose                              |
| --------------- | ------------------------------------ |
| Manual editing  | Primary professional workflow        |
| Prompt commands | Fast operations via natural language |
| Voice commands  | Hands-free editing                   |

All three methods execute the **same internal command system**. There is no special AI execution path — AI produces typed actions, the command system executes them, just as manual UI does.

---

# 3. Core UX Philosophy

## AI is an assistant, not a replacement

Users must always be able to:

- override any AI action
- manually edit any AI change
- undo AI operations individually

AI tasks run **non-blocking**. Users continue editing during AI tasks.

AI changes are highlighted visually so the user always knows what changed.

---

# 4. Layout Overview

```
---------------------------------------------------------
| Transport | Tools | Prompt Bar         | Voice Button |
---------------------------------------------------------
| Browser   | Arrangement Workspace     | Inspector    |
|           |                           |              |
|           |                           |              |
---------------------------------------------------------
| Mixer Panel (dockable, collapsed by default)         |
---------------------------------------------------------
```

All panels are resizable. The sidebar (Browser) and Inspector can be toggled. The Mixer docks to the bottom.

---

# 5. Primary Interface Areas

## Transport Bar

Always visible at the top. Contains:

- Play / Stop / Record
- Loop toggle
- Tempo (BPM, editable inline)
- Time signature
- Metronome toggle
- CPU / latency meter
- AI status indicator (idle / processing / error)

## Prompt Bar

Persistent text input for natural language commands. Always visible in the toolbar.

Examples:

```
add shaker from bar 8 to 16
make this bass warmer
duplicate chorus
tighten drums
quantize kick to 1/16
```

Behavior:
1. User types and submits
2. AI parses input into planned actions
3. Preview shown: what will happen, which tracks are affected
4. User confirms (or cancels)
5. Actions execute

For non-destructive commands (e.g., set tempo), execute immediately with undo support. Require confirmation for destructive or multi-track operations.

## Voice Command Input

Triggered by a configurable keyboard shortcut (default: hold `V`).

Displays:
- listening indicator
- live waveform animation
- transcript preview as speech is recognized

Recognized transcript feeds into the same prompt parsing pipeline as text input.

## Browser Panel

Left sidebar. Unified content browser for:

- samples and audio files
- plugins and instruments
- presets
- MIDI patterns and clips

Features:
- fuzzy search
- tag filtering
- favorites
- browse history

## Arrangement Workspace

Primary editing surface. Contains:

- track headers (left column)
- timeline grid (right, scrollable horizontally)
- audio clips, MIDI clips, automation lanes
- markers and arrangement sections
- playhead

Everything is editable inline. No modal editors — double-clicking a MIDI clip switches to Clip Mode in the same view.

## Inspector Panel

Right sidebar. Context-aware — shows properties for whatever is selected:

- track: name, color, routing, gain, pan, sends
- clip: start, length, pitch, warp settings
- device/plugin: all parameters with automation indicator
- automation: curve editing controls

Inspector replaces floating plugin/parameter windows.

## Mixer Panel

Dockable bottom panel (collapsed by default). Contains:

- channel strips for all tracks
- faders and meters
- send levels
- routing visualization
- plugin chain slots (plugins open in Inspector when clicked)

---

# 6. Workspace Modes

Three modes, selectable from the toolbar. Modes change **layout only** — all data is always present.

## Arrange Mode (default)

Focus: clips, arrangement, automation on the timeline.

- full timeline width
- track headers visible
- Inspector on right

## Clip Mode

Focus: detailed editing of a selected clip.

- Piano roll (MIDI clips)
- Audio waveform with warp markers (audio clips)
- Note velocity editor
- Automation lane for the clip

## Mix Mode

Focus: mixer and signal flow.

- Expanded channel strips
- Full routing visualization
- All meters visible
- Inspector shows plugin parameters

---

# 7. Track Model

Tracks are unified objects — no separate "audio track" and "MIDI track" types.

```
Track
 ├ Clips        ← audio clips, MIDI clips, mixed
 ├ Devices      ← plugin rack (instruments + effects)
 ├ Sends        ← send levels to bus tracks
 ├ Automation   ← per-parameter envelopes
 └ Modulators   ← LFOs, envelope followers (future)
```

Track kinds:
- **Audio** — records and plays audio files
- **MIDI** — sequences MIDI, routes to instrument devices
- **Bus** — receives sends, applies processing, routes to master or other buses
- **Master** — final output

---

# 8. Device Rack

Plugins and instruments appear as **devices in a rack**, not as floating windows.

```
Track
 ├ Instrument (Synth)
 ├ EQ Eight
 ├ Compressor
 └ Reverb Send
```

Benefits:
- visible signal chain
- easy drag-to-reorder
- inline bypass toggle
- parameters accessible in Inspector on click

---

# 9. Editing Tools

Minimal toolset. Tool is selected from the toolbar or by keyboard shortcut.

| Tool       | Shortcut | Purpose                          |
| ---------- | -------- | -------------------------------- |
| Select     | S        | move and resize clips            |
| Cut        | C        | split clips at cursor            |
| Draw       | D        | create clips / draw MIDI notes   |
| Automation | A        | draw and edit automation curves  |
| Stretch    | T        | time-stretch clips               |

Right-click context menu exposes all remaining operations. No tool needed for common actions like mute, solo, rename.

---

# 10. Automation System

Automation appears **inline within the track**, below its clips. No separate automation editor.

Features:
- draw freehand curves
- draw linear segments
- scale entire envelope
- copy automation between parameters
- clip automation (automation follows the clip)
- automation from any plugin parameter via right-click → "Edit Automation"

---

# 11. Routing System

Signal routing visualization appears on hover over any track or bus.

Example:

```
Kick → Drum Bus → Master
Bass → Music Bus → Master
Pad  → FX Bus → Music Bus → Master
```

Routing is editable via the Inspector when a track is selected.

---

# 12. Command System

Every operation in the app maps to a typed command (AppAction). This powers prompt commands, voice commands, keyboard shortcuts, and menu actions uniformly.

Example commands:

```
addTrack       renameTrack     removeTrack
setTempo       togglePlayback  setMasterGain
addClip        moveClip        duplicateClip
soloTrack      muteTrack       armTrack
addDevice      bypassDevice    removeDevice
quantizeNotes  humanizeNotes   transposeNotes
createBus      setSend         setRouting
```

The full command registry is defined in `src/modules/Command/models/AppAction.ts`.

---

# 13. AI Prompt Workflow

```
1. User types prompt
2. AI parses → planned actions (typed AppAction[])
3. Preview displayed: label per action, affected elements highlighted
4. User confirms or cancels
5. Actions execute via command system
6. Undo entry created
```

For simple, non-destructive commands (e.g. "set tempo to 128"), skip confirmation and execute immediately.

Require confirmation for:
- multi-track operations
- deletions
- operations affecting clips with unsaved audio
- anything irreversible without undo

---

# 14. Voice Command System

Push-to-talk via configurable shortcut (default: hold `V`).

```
"mute the guitar track"
"add reverb to vocals"
"loop bars 8 to 16"
"bump up the tempo"
"duplicate the chorus"
```

Voice transcript feeds into the same prompt parsing pipeline. No separate voice command registry needed.

ASR runtime:
- Desktop: whisper.cpp sidecar (bundled, offline, high quality)
- Browser: Whisper ONNX (downloaded on first use, cached offline)

---

# 15. AI Task System

AI tasks (generation, analysis, longer operations) run asynchronously.

```
Task Queue
 ├ command interpretation   (< 300 ms — feels instant)
 ├ audio analysis           (< 1 s — background)
 └ music generation         (< 2 s — progress shown)
```

UI during AI task:
- prompt bar shows spinner / progress
- affected tracks show subtle "processing" overlay
- user can continue editing unaffected areas
- task can be cancelled

---

# 16. AI Change Visualization

When AI completes a change:
- affected tracks/clips briefly highlighted
- summary overlay appears near the change

Example:

```
✓ EQ applied to Kick
  +2 dB at 5 kHz, -3 dB at 200 Hz
  [Undo]  [Accept]
```

User can undo AI operations individually. AI changes are never silent.

---

# 17. Command Palette

Shortcut: `Ctrl/Cmd + K`

Fuzzy search over all available commands. Works like a traditional command palette.

Examples:

```
> create bus
> normalize audio
> sidechain bass to kick
> export stems
```

Executes the same AppAction commands as prompt and voice input.

---

# 18. Undo System

Every operation — manual, prompt, voice, or AI — produces an undo entry.

```
Undo history:
  Apply EQ to Kick
  Duplicate Chorus (AI)
  Humanize Drums (AI)
  Move Clip: Bass Riff → bar 9
  Set Tempo: 128 BPM
```

Undo is unlimited within a session. AI operations are individually reversible.

---

# 19. Smart Suggestions (Optional / Future)

Contextual AI suggestions can appear non-intrusively when the user pauses.

Example:

```
Suggested:
• Humanize hi-hat velocity
• Add groove to drum loop
• Layer a second percussion track
```

These are suggestions only — user must explicitly trigger them. Never auto-apply.

---

# 20. Safety Constraints

AI must never:

- delete tracks or clips silently
- overwrite recorded audio without confirmation
- change routing without confirmation
- apply any change that cannot be individually undone

All destructive operations require explicit confirmation, regardless of whether they were triggered by prompt, voice, or UI.

---

# 21. Project Context

When the AI interprets a prompt, it receives structured context about the current project state:

```
{
  tempo: number,
  timeSignature: [number, number],
  tracks: Track[],
  selectedTrackId: string | null,
  selectedClipId: string | null,
  activeView: "arrange" | "clip" | "mix",
  playheadPosition: number
}
```

This allows the AI to understand "this track" or "the selected clip" correctly.

---

# 22. Discoverability

Every feature must be reachable through at least one of:

1. Right-click context menu
2. Command palette (`Ctrl/Cmd + K`)
3. Prompt bar
4. Keyboard shortcut

No feature should require knowing a specific menu path to access it.

---

# 23. Accessibility

Must support:

- keyboard-only workflow for all core editing operations
- large track height mode (option in preferences)
- colorblind-safe palette (no red/green-only distinctions)
- screen reader metadata on transport controls and track headers
- `aria-label` on all icon-only buttons
- `aria-live` regions for AI status and transport position

See `.agents/skills/frontend-a11y/SKILL.md` for implementation patterns.

---

# 24. Visual Style

- **Dark mode by default** — `class="dark"` on `<html>` from startup
- Subtle color coding for track types (audio / MIDI / bus)
- High-contrast level meters
- Low visual clutter — no decorative chrome
- Consistent use of Shadcn UI components for all standard UI
- Custom WebGPU / Canvas rendering only for dense editor surfaces

---

# 25. Minimum Feature Set (v1 Scope)

Essential capabilities required before the product is considered functional:

- audio recording and playback
- MIDI editing (piano roll)
- audio clip editing (trim, move, split)
- automation (draw and edit)
- plugin hosting (VST3 / CLAP via native host)
- send/return routing
- bus groups
- sidechain routing
- track folders / grouping
- comping (multiple takes)
- warping / time-stretching
- tempo mapping
- markers and arrangement sections
- freeze / bounce tracks
- export stems

---

# 26. Future Expansion

The architecture must not foreclose:

- real-time collaboration and remote sessions
- advanced AI mixing assistants
- generative instruments and procedural sound design
- deeper plugin parameter AI control
- mobile / tablet companion interface

---

# End of Specification
