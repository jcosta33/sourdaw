# Sourdaw

A modern, browser-native digital audio workstation (DAW) built with React 19, TypeScript, and the Web Audio API. Runs in any modern browser and as a native desktop app via Tauri.

## Features

- **Multi-track timeline** — Arrange MIDI and audio clips on an unlimited number of tracks
- **Piano roll editor** — Full-featured MIDI note editor with draw, select, resize, and velocity editing
- **Mixer console** — Channel strips with volume faders, pan knobs, mute/solo, and send buses
- **Automation lanes** — Draw and edit parameter automation with linear, S-curve, and exponential interpolation
- **Transport controls** — Play, pause, record, loop, metronome, tempo, and time signature
- **Command palette** — Quick access to every action via `⌘K`
- **AI copilot** — Built-in chat panel for AI-assisted music production with voice command support
- **Project management** — Save, load, new project, import/export (WAV, MP3, MIDI)
- **Undo / Redo** — Full undo history with per-action snapshots
- **Collaboration** — Real-time collaboration panel (experimental)
- **Cross-platform** — Runs in the browser or as a native app via Tauri

## Tech Stack

| Layer        | Technology                                                         |
| ------------ | ------------------------------------------------------------------ |
| UI Framework | React 19 with React Compiler                                       |
| Language     | TypeScript 5.9                                                     |
| Build Tool   | Vite 8                                                             |
| Styling      | Tailwind CSS v4                                                    |
| State        | Vanilla TypeScript Stores + TanStack Query         |
| Routing      | TanStack Router                                                    |
| Audio        | Web Audio API + AudioWorklet                                       |
| Desktop      | Tauri 2                                                            |
| AI           | Web LLM (browser-local), llama.cpp / whisper.cpp (desktop sidecar) |

## Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** (recommended package manager)
- For desktop builds: [Tauri prerequisites](https://tauri.app/start/prerequisites/)

### Installation

```bash
git clone https://github.com/jcosta33/sourdaw.git
cd sourdaw
pnpm install
```

### Running

```bash
# Web (development server with HMR)
pnpm dev

# Desktop via Tauri
pnpm tauri:dev
```

The app will open at [http://localhost:5173](http://localhost:5173).

### Building

```bash
# Web production bundle
pnpm build
pnpm preview        # serve the production build locally

# Desktop production binary
pnpm tauri:build
```

### Code Quality

```bash
pnpm typecheck      # TypeScript type checking
pnpm lint           # ESLint
pnpm lint:fix       # ESLint with auto-fix
pnpm format         # Prettier formatting
```

---

## User Guide

### Layout Overview

The interface follows a standard DAW layout:

```
┌─────────────────────────────────────────────────┐
│                  Transport Bar                   │
├────────┬───────────────────────┬────────┬────────┤
│        │                       │Autom.  │  AI    │
│Sidebar │   Timeline / Arrange  │ Panel  │ Chat   │
│        │    (main content)     │        │        │
├────────┴───────────────────────┴────────┴────────┤
│                  Mixer Panel                     │
├─────────────────────────────────────────────────┤
│                   Status Bar                     │
└─────────────────────────────────────────────────┘
```

All panels are **resizable** by dragging their borders and can be toggled on/off via keyboard shortcuts.

---

### Transport

The top bar contains playback and project controls:

- **Play / Pause** — Click the play button or press `Space`
- **Stop** — Press `Escape`
- **Record** — Click the record button or press `R`
- **Loop** — Toggle with the loop button or press `L`
- **Metronome** — Toggle with `M`
- **Tempo** — Click the BPM display to edit
- **Time signature** — Click to change
- **Navigate** — `Home` jumps to start, `End` jumps to end

---

### Timeline / Arrange View

The main content area shows tracks and clips on a timeline grid.

#### Working with tracks

| Action          | How                                             |
| --------------- | ----------------------------------------------- |
| New MIDI track  | Press `N`                                       |
| New audio track | Press `Shift+N`                                 |
| Duplicate track | `⌘⇧D`                                           |
| Delete track    | Right-click → Delete                            |
| Rename track    | Double-click the track name                     |
| Mute / Solo     | Click the `M` / `S` buttons on the track header |
| Clear all solos | `Alt+S`                                         |

#### Working with clips

| Action                | How                                          |
| --------------------- | -------------------------------------------- |
| Select clip           | Click it                                     |
| Multi-select          | `⌘+click` or `⌘A` (select all)               |
| Move clip             | Drag to new position or track                |
| Copy / Cut / Paste    | `⌘C` / `⌘X` / `⌘V`                           |
| Duplicate             | `⌘D`                                         |
| Duplicate to next bar | `Alt+D`                                      |
| Delete clip           | Select + `Delete` or `Backspace`             |
| Split clip            | Select the Cut tool (`C` or `2`), then click |
| Open clip editor      | Double-click or press `Tab`                  |

#### Editing tools

Switch tools via the toolbar or keyboard:

| Key        | Tool        | Description                            |
| ---------- | ----------- | -------------------------------------- |
| `S` or `1` | Select      | Click to select, drag to move          |
| `C` or `2` | Cut / Split | Click a clip to split it at that point |
| `D` or `3` | Draw        | Click to create new clips              |
| `A` or `4` | Automation  | Click to add automation points         |
| `T` or `5` | Stretch     | Drag clip edges to time-stretch        |

#### Zoom & navigation

| Action             | How                        |
| ------------------ | -------------------------- |
| Zoom in / out      | `=` / `-` or pinch gesture |
| Zoom to fit        | `F`                        |
| Zoom to selection  | `Shift+F`                  |
| Scroll to playhead | `Shift+L`                  |
| Zoom track heights | `⌘⇧=` / `⌘⇧-`              |
| Navigate markers   | `]` next / `[` previous    |

---

### Piano Roll (MIDI Editor)

Open by double-clicking a MIDI clip (or pressing `Tab` with a clip selected).

#### Creating notes

- **Click** on empty space to draw a note (uses current grid snap)
- **Click and drag** to set the note length while drawing
- **Step input mode** — Toggle with the Step button; press pitch keys to enter notes sequentially

#### Selecting notes

| Action                            | How                       |
| --------------------------------- | ------------------------- |
| Select one note                   | Click it                  |
| Toggle selection                  | `Shift+click`             |
| Rubber-band select                | `Alt+drag` on empty space |
| Add to selection with rubber-band | `Shift+Alt+drag`          |
| Select all                        | `⌘A`                      |

#### Editing notes

| Action                   | How                                                    |
| ------------------------ | ------------------------------------------------------ |
| Move note(s)             | Drag a selected note (all selected move together)      |
| Resize note (left/right) | Drag the left or right edge                            |
| Delete note              | `Double-click` or select + `Delete`/`Backspace`        |
| Nudge in time            | `←` / `→` (uses grid snap)                             |
| Transpose                | `↑` / `↓` (semitone) or `Shift+↑` / `Shift+↓` (octave) |
| Set velocity             | Keys `1`–`7` set velocity presets (in step input mode) |

#### Grid snap

Change the grid resolution with the snap buttons: `1` (whole), `1/2`, `1/4`, `1/8`

#### Scale highlighting

Select a root note and scale type to highlight in-key rows.

#### Context menu (right-click)

Select all, copy, cut, paste, quantize, humanize, and more.

---

### Automation

Toggle the automation panel with `⌘⇧A`.

#### Adding points

- Select the Automation tool (`A` or `4`), then click on the automation lane
- Or click directly in the automation panel

#### Editing points

| Action            | How                                                             |
| ----------------- | --------------------------------------------------------------- |
| Move point        | Drag it                                                         |
| Delete point      | `Double-click` it                                               |
| Change curve type | Right-click → choose curve (linear, S-curve, exponential, step) |

#### Parameters

Each track has automation lanes for volume, pan, mute, and plugin parameters. Select the parameter from the dropdown in each lane.

---

### Mixer

Toggle with `⌘M`. Shows channel strips for all tracks with:

- **Volume fader** — Drag to adjust level
- **Pan knob** — Drag to adjust stereo position
- **Mute / Solo** — Click the `M` / `S` buttons
- **Send buses** — Route audio to effect buses

---

### AI Copilot

Toggle with `⌘J`. The AI chat panel lets you:

- Ask questions about your project
- Request automated edits (add tracks, set tempo, etc.)
- Get mix analysis and suggestions

#### Voice commands

Hold `V` to speak a voice command (requires microphone permission).

---

### Project Management

| Action       | How                                     |
| ------------ | --------------------------------------- |
| New project  | File menu → New Project                 |
| Save project | `⌘S` (also auto-saves every 30 seconds) |
| Export audio | `⌘⇧E` → choose format (WAV / MP3)       |
| Import MIDI  | File menu → Import MIDI                 |
| Preferences  | `⌘,`                                    |

---

### Keyboard Shortcuts Reference

Press `?` at any time to open the full shortcut cheat sheet overlay.

#### Global

| Shortcut | Action               |
| -------- | -------------------- |
| `⌘K`     | Command palette      |
| `⌘Z`     | Undo                 |
| `⌘⇧Z`    | Redo                 |
| `⌘S`     | Save project         |
| `⌘⇧E`    | Export audio         |
| `⌘,`     | Preferences          |
| `?`      | Shortcut cheat sheet |

#### Panels

| Shortcut | Panel      |
| -------- | ---------- |
| `⌘B`     | Sidebar    |
| `⌘I`     | Inspector  |
| `⌘M`     | Mixer      |
| `⌘⇧A`    | Automation |
| `⌘J`     | AI Chat    |
| `⌘T`     | Track list |

#### Transport

| Shortcut | Action           |
| -------- | ---------------- |
| `Space`  | Play / Pause     |
| `Escape` | Stop / Deselect  |
| `R`      | Record           |
| `L`      | Toggle loop      |
| `M`      | Toggle metronome |
| `Home`   | Go to start      |
| `End`    | Go to end        |

#### Editing

| Shortcut            | Action                |
| ------------------- | --------------------- |
| `⌘C`                | Copy clip             |
| `⌘X`                | Cut clip              |
| `⌘V`                | Paste clip            |
| `⌘D`                | Duplicate clip        |
| `⌥D`                | Duplicate to next bar |
| `⌘A`                | Select all            |
| `⌘⇧A`               | Deselect all          |
| `Del` / `Backspace` | Delete selected       |

#### View

| Shortcut  | Action             |
| --------- | ------------------ |
| `=` / `+` | Zoom in            |
| `-`       | Zoom out           |
| `F`       | Zoom to fit        |
| `⇧F`      | Zoom to selection  |
| `⇧L`      | Scroll to playhead |
| `⌘⇧=`     | Zoom tracks in     |
| `⌘⇧-`     | Zoom tracks out    |

#### Tracks

| Shortcut | Action          |
| -------- | --------------- |
| `N`      | New MIDI track  |
| `⇧N`     | New audio track |
| `⌘⇧D`    | Duplicate track |
| `⌥S`     | Clear all solos |

---

## Architecture

The codebase follows a **domain-driven design** with strict module boundaries:

```
src/modules/
├── AiRuntime/      # AI copilot, voice commands, inference
├── AudioEngine/    # Web Audio API, AudioWorklet, DSP
├── Collaboration/  # Real-time collaboration
├── Command/        # Actions, undo/redo, keyboard shortcuts
├── Project/        # Project persistence, import/export
├── Timeline/       # Timeline rendering, grid, markers
├── Track/          # Tracks, clips, MIDI, automation
├── Transport/      # Playback, recording, metronome
└── Workspace/      # UI shell, panels, layout
```

Each module exposes a public API through **contract folders** (`models/`, `events/`, `useCases/`, `presentations/views/`). Cross-module imports may only reference these contracts.

For detailed architecture documentation, see [`docs/architecture.md`](docs/architecture.md).

---

## License

Private — All rights reserved.
