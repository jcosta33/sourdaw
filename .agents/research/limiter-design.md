# Crust — Design Specification

### Limiter / Saturator · Sourdaw Built-in Plugin

**Version 0.1 · For AI Agent Implementation**

---

## 1. Design Philosophy

### Concept

Crust is the final stage of any Sourdaw master chain — the hard outer shell before the signal leaves. The name carries the bread theme: the crust is what forms under intense heat, what protects the interior, what gives structure and character. It is both protective (brick-wall ceiling) and expressive (saturation, colour, harmonic richness).

The design must communicate two things simultaneously:

- **Precision and safety** — this is mastering-grade infrastructure. Everything must feel exact, controlled, trustworthy.
- **Heat and character** — the saturation section adds warmth. The plugin has texture. It is not a cold utility.

### Design North Star

> "Maximum information density, minimum cognitive load."

Every pixel earns its place. The interface should feel like standing in front of a high-end hardware mastering unit — something between a Weiss DS1-MK3 and a Neve 33609. Dark, purposeful, numbers you can trust.

### Anti-Patterns to Avoid

- No neumorphism, glassmorphism, or overly soft design
- No decorative bread imagery or skeuomorphic knobs with fake shadows
- No information buried behind hover states unless explicitly in Level 5
- No animations that distract during critical listening moments
- No light themes — this is a tool for dark studio environments

---

## 2. Visual Identity

### Color Palette

**Background & Structure**
| Role | Hex | Usage |
|---|---|---|
| Background deep | `#0E0E10` | Plugin body, primary background |
| Background mid | `#161619` | Panel areas, module backgrounds |
| Background raised | `#1E1E22` | Knob wells, meter backgrounds |
| Surface | `#28282E` | Cards, separators, grouped controls |
| Border subtle | `#2E2E36` | Dividers, inactive borders |

**Text**
| Role | Hex | Usage |
|---|---|---|
| Text primary | `#E8E6E0` | Main labels, values — warm off-white, not pure white |
| Text secondary | `#8A8890` | Sub-labels, units |
| Text muted | `#52515A` | Inactive labels, disabled state |

**Signal & Metering**
| Role | Hex | Usage |
|---|---|---|
| Signal blue | `#4A9ECC` | Input signal waveform |
| Output blue | `#1F6B99` | Output/post-limiting waveform |
| GR white | `#E8E6E0` | 0dB gain reduction (no limiting) |
| GR yellow | `#D4A847` | Moderate gain reduction (1–4dB) |
| GR orange | `#C87C2A` | Heavy gain reduction (4–8dB) |
| GR red | `#C44030` | Extreme gain reduction (8dB+) / clipping |
| GR fill | `#C44030` at 25% opacity | Shaded area under GR curve |
| LUFS track | `#7FC8A0` | LUFS history line — cool green |
| Target line | `#4A7C6F` | LUFS target reference line |

**Saturation / Warmth**
| Role | Hex | Usage |
|---|---|---|
| Warm amber | `#D4883A` | Saturation section accent, drive indicators |
| Warm amber dim | `#6B4420` | Saturation section background tint |
| Harmonic gold | `#C4A030` | Active saturation algorithm indicator |

**Interaction**
| Role | Hex | Usage |
|---|---|---|
| Active / selected | `#5B8FC4` | Selected algorithm, active toggles |
| Hover | `#FFFFFF` at 6% opacity | Hover overlay on interactive elements |
| True peak alert | `#C44030` | True peak exceeded — flashes |
| True peak OK | `#4A7C6F` | True peak within ceiling |

### Typography

- **Display / values**: `"JetBrains Mono"` or `"IBM Plex Mono"` — monospaced for consistent meter readouts and numerical values. Numbers must not shift width as they update.
- **Labels / UI text**: `"Inter"` at weight 500 — clean, neutral, not decorative.
- **Module headers / section labels**: `"Inter"` at weight 600, letter-spacing `0.08em`, ALL CAPS.

### Iconography

- Minimal line icons at 14×14px for toggles (True Peak, Delta, Link)
- No filled icon style — use 1.5px stroke weight
- Icon set should feel consistent with FabFilter's minimal approach

---

## 3. Layout Architecture

### Plugin Window Sizes

| Size        | Dimensions    | Use case                                  |
| ----------- | ------------- | ----------------------------------------- |
| Compact     | `420 × 200px` | Small screen / second monitor glance view |
| Standard    | `640 × 360px` | Default. The primary working size.        |
| Large       | `960 × 520px` | Full session with expanded metering       |
| Full-screen | User-defined  | Mastering sessions, detailed work         |

All sizes maintain the same component hierarchy — they scale proportionally. Standard (640×360) is the canonical design target.

### Standard Layout (640×360) — Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  CRUST          [LEVEL ●●○○○]   [PRESET ▾]   [?]   [⋯]        │  ← 28px header
├──────┬──────────────────────────────────────────┬───────────────┤
│      │                                          │               │
│  G   │           WAVEFORM / GR DISPLAY          │   METERING    │
│  A   │                (scrolling)               │    SECTION    │
│  I   │                                          │               │
│  N   ├──────────────────────────────────────────┤               │
│      │         CONTROL ZONE                     │               │
│  ▐   │   (changes per level 1-5)                │               │
│  ▐   │                                          │               │
│      │                                          │               │
└──────┴──────────────────────────────────────────┴───────────────┘
  ~52px          ~420px                              ~160px
```

**Zone breakdown:**

- **Left strip (52px)**: Vertical Gain slider — always visible at every level
- **Center top (420×160px)**: Waveform/GR display — always visible
- **Center bottom (420×130px)**: Control zone — changes per complexity level
- **Right strip (160px)**: Metering section — always visible (collapses to icons in Compact)

---

## 4. The Five Complexity Levels

### Level Selector

Located in the header bar. Displayed as 5 filled/unfilled dots: `● ● ○ ○ ○`

Clicking a dot selects that level. The control zone animates a 150ms fade/crossfade between levels — fast enough to not interrupt workflow. No slide animations — they feel slow during working sessions.

**Persistent across levels:**

- Gain slider (left)
- Ceiling / Output Level (bottom bar)
- Waveform / GR display (center top)
- Metering strip (right)
- Header (plugin name, level selector, preset, help)

---

### Level 1 — PLAY

> "Set the ceiling, push the gain, done."

**Target user**: Songwriter, producer who needs mastering quality output without mastering knowledge.

**Visible controls:**

1. **Gain slider** (left strip) — the only "push" control. Range: 0 to +18dB.
2. **Style selector** (center, prominent) — 3 options: `TRANSPARENT` · `PUNCHY` · `LOUD`. Displayed as 3 large radio-button tiles with a brief character description (1 line). No dropdowns.
3. **Ceiling** (bottom bar, inline with output level) — single numerical field. Default: `-0.3 dBFS`. Click to type, scroll to adjust.
4. **True Peak LED** (bottom bar) — small indicator: green = safe, red = exceeded. Always visible.

**LUFS display** (right strip): Shows only Integrated LUFS as a large number (`-14.2`) with a small target indicator below it (e.g. `▶ -14 LUFS Streaming`).

**What is hidden**: All advanced limiter controls, saturation, multi-band, dithering, detailed metering.

**Layout sketch (center bottom zone, Level 1):**

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ┌─────────────────┐  ┌─────────────────┐  ┌───────────┐  │
│   │  TRANSPARENT    │  │    PUNCHY       │  │   LOUD    │  │
│   │  Clean ceiling  │  │  Snap & punch   │  │  Maximum  │  │
│   │  for any mix    │  │  for rhythmic   │  │  loudness │  │
│   └─────────────────┘  └─────────────────┘  └───────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### Level 2 — SHAPE

> "Full limiter control. For producers who know what they're doing."

**Additional controls revealed:**

1. **Algorithm selector** — now expands to show all 8 styles (see §6 for visual design)
2. **Lookahead** — knob, range 0–10ms. Default: 2ms.
3. **Attack** — knob, range 0–100ms logarithmic taper. Default: auto.
4. **Release** — knob, range 0–1000ms logarithmic taper. Default: auto.
5. **Channel Link (Transient)** — 0–100% slider. Default: 100%.
6. **Channel Link (Release)** — 0–100% slider. Default: 100%.
7. **True Peak toggle** — prominent toggle button in bottom bar (was just LED in L1)
8. **Oversampling** — dropdown: Off / 4× / 8× / 16× / 32×. Default: 4×.

**Metering strip**: Expands to show Momentary + Short-Term LUFS alongside Integrated. GR meter appears between L/R output meters.

**Layout sketch (center bottom zone, Level 2):**

```
┌─────────────────────────────────────────────────────────────┐
│  STYLE  [Transparent ▾]        LOOKAHEAD  ATTACK  RELEASE  │
│                                 [2.0ms]  [Auto]  [Auto]    │
│                                                             │
│  CH LINK  TRANSIENT ████████░░░ 80%   RELEASE ██████████ 100% │
│                                                             │
│  TRUE PEAK [●ON]   OVERSAMPLE [4×▾]                         │
└─────────────────────────────────────────────────────────────┘
```

---

### Level 3 — BUILD

> "Shape the sound. Use the clipper. Listen to what you're removing."

**Additional controls revealed:**

1. **Saturation section** — revealed as a dedicated sub-panel below the limiter controls, with a warm amber left border accent and a subtle `#1A1208` background tint
2. **Algorithm selector**: `SOFT` · `HARD` · `TAPE` · `TUBE` · `FOLD` — pill-style radio buttons
3. **Drive knob** — 0 to +18dB. Pre-limiter input saturation level.
4. **Mix knob** — 0–100%. Parallel saturation blend.
5. **Input/Output curve display** — small 80×80px curve display showing the saturation transfer function (see §7)
6. **Delta monitoring button** — `DELTA` toggle. When active: entire background of the waveform display inverts to a dark red `#1A0805` tint and the waveform changes to show only the removed signal. A persistent label `◉ DELTA MONITORING` appears in the display.
7. **Auto-gain match toggle** — `A=B` button. When active: automatically reduces output level to match input loudness for honest comparison.

**Layout sketch (center bottom zone, Level 3):**

```
┌─────────────────────────────────────────────────────────────┐
│  LIMITER STYLE [Transparent ▾]   LOOK  ATTACK  RELEASE      │
│                                                             │
├── SATURATION ───────────────────────────────────────────────┤ ← amber left border
│  [SOFT] [HARD] [TAPE] [TUBE] [FOLD]   [curve]  DRIVE  MIX  │
│                                       [ ╱╲  ]  [4.2]  [35%]│
├─────────────────────────────────────────────────────────────┤
│  TRUE PEAK [●]  OVERSAMPLE [4×]  [DELTA]  [A=B]            │
└─────────────────────────────────────────────────────────────┘
```

---

### Level 4 — ROUTE

> "Configure the signal path. Multi-band. Sidechain. Dithering."

**Additional controls revealed:**

1. **Multi-band toggle** — `WIDEBAND` / `3 BAND` / `5 BAND` pill selector. When multi-band: the waveform display gains a horizontal frequency split view showing per-band GR.
2. **Band crossover frequencies** (when multi-band active) — two or four draggable handles on a mini frequency display (80Hz, 2kHz defaults for 3-band)
3. **Sidechain HPF** — toggle + cutoff frequency control (range: 20–200Hz). Prevents low bass from triggering the limiter.
4. **Stereo mode** — `STEREO` · `M/S` toggle
5. **Dithering** — dropdown: `OFF` / `TPDF 16-bit` / `TPDF 24-bit` / `POW-R 1` / `POW-R 2` / `POW-R 3`
6. **Output bit depth** (only visible when dithering active) — `16` / `24` / `32`

---

### Level 5 — LAB

> "Expert mode. Custom curves, multi-stage chain, full statistics."

**Additional controls revealed:**

1. **Custom saturation curve editor** — an interactive x/y curve editor (200×200px) with draggable nodes. Shows transfer function. Can save/load custom curve presets.
2. **Multi-stage chain view** — shows the processing chain as explicit stages: `[CLIPPER] → [LIMITER] → [CEILING]`. Each stage shows its own GR meter. Stages can be enabled/disabled individually.
3. **Loudness statistics panel** — full readout (replaces part of the waveform display or appears as an overlay tab):
    - Integrated LUFS
    - Short-term LUFS max
    - Momentary LUFS max
    - LRA (Loudness Range)
    - True Peak Max
    - PLR (Peak-to-Loudness Ratio)
    - Crest Factor
    - Dynamic Range (PSR)
4. **A/B state** — two slots to compare limiter settings. Toggle between A and B with `A` / `B` buttons in header.

---

## 5. Waveform / Gain Reduction Display

This is the centrepiece of Crust, analogous to Pro-L 2's signature scrolling display. It must be real-time, GPU-rendered, and information-dense without being cluttered.

### What is displayed

**Layer 1 — Input waveform** (`#4A9ECC` at 60% opacity, filled)
The incoming signal waveform, scrolling left-to-right continuously. The rightmost edge is "now". Scrolls at a default speed of ~2–4 seconds of history visible in the standard display.

**Layer 2 — Output waveform** (`#1F6B99` at 80% opacity, filled)
The post-limiting output. Sits on top of the input, darker. The delta between input and output is visually apparent as the blue "ceiling" effect.

**Layer 3 — Gain Reduction fill** (`#C44030` at 20% opacity)
Shaded area between input and output waveforms. Immediately communicates where and how much limiting is happening.

**Layer 4 — GR curve trace** (top of display, 1.5px line)
A thin continuous line at the top of the display tracking the gain reduction amount in real time:

- `#E8E6E0` (white) = 0dB GR (no limiting)
- `#D4A847` (yellow) = 1–4dB GR
- `#C87C2A` (orange) = 4–8dB GR
- `#C44030` (red) = 8dB+ GR

The line changes color along its length based on the actual GR at each point.

**Layer 5 — LUFS curve** (`#7FC8A0`, 1px thin line)
A thin green line tracking Short-Term LUFS over time, plotted against the secondary Y-axis (right side of display, LUFS scale). Appears as a gentle undulating curve that contextualises loudness changes alongside the peak-focused waveform.

**Layer 6 — Peak GR labels**
At significant GR events (peaks ≥ 3dB of gain reduction), a small label appears at the top of the GR trace showing the dB value (e.g. `-4.2`). Labels use `JetBrains Mono` at 9px. Labels fade after 3 seconds unless the GR remains. Maximum 4 visible labels at once. This is directly inspired by Pro-L 2's best-in-class labelling.

**Layer 7 — Target LUFS line** (when streaming preset is active)
A subtle horizontal dashed line (`#4A7C6F`) across the LUFS axis marking the target. The LUFS curve crosses it visibly.

### Display Controls (bottom-left corner of display area)

Three tiny icon buttons:

- **Scroll speed** (⏩ icon): Slow / Normal / Fast / Infinite (compression mode — history compresses to keep all visible)
- **Y-scale** (-18dB view / -6dB view / -3dB view): Zooms the GR scale for fine work
- **Clear** (⟲): Resets the scrolling history

### Delta mode state

When Delta monitoring is active:

- Waveform display background becomes `#1A0805` (very dark red)
- A persistent `◉ DELTA MONITORING` label in `#C44030` sits in the top-left of the display
- Only the removed signal is shown (no input/output, just what the limiter is taking away)
- The waveform color changes to `#C44030`
- This is a jarring, unmistakable visual state — intentional, because the user must know they are not hearing the output

---

## 6. Gain Reduction Meter (Right Strip — Metering Section)

### Structure

The right strip (160px wide) contains three zones from top to bottom:

```
┌──────────────────────────┐
│  OUTPUT METERS           │  ← L/R bar meters, 0 to -60dB
│  [L ▐▐▐▐▐▐░░░] [R ▐▐▐░]  │
│  [GR ▐▐░░░░░░]   -2.1dB  │  ← Gain Reduction meter (center, inverted)
├──────────────────────────┤
│  LUFS SECTION            │
│  INT   -14.2 LUFS        │  ← Large number, primary metric
│  ST    -13.8             │  ← Short-term
│  MOM   -12.1             │  ← Momentary
├──────────────────────────┤
│  LRA    4.2 LU           │
│  TP MAX -0.3 dBTP  [●]   │  ← True peak indicator LED
└──────────────────────────┘
```

### Output Meters (L/R)

- Vertical bar meters, range: +6 to -60dBFS (with 0dBFS marked prominently)
- Thin, tall proportions — similar to Pro-L 2's output meters
- Color: `#4A9ECC` below -6dB, `#D4A847` from -6 to -3dB, `#C44030` above -3dB
- Peak hold: small tick mark holds for 2 seconds, then falls
- Numeric peak readout at top of each meter (updates on new peak)

### Gain Reduction Meter

- Inverted bar — fills downward from 0
- Color gradient matching the GR curve: white → yellow → orange → red
- Scale: 0 to -18dB
- Numeric GR readout next to meter (shows current instantaneous value)
- Maximum GR hold tick (shows session maximum)

### LUFS Readouts

- Integrated LUFS: 22px, `JetBrains Mono`, weight bold. This is the number mastering engineers care about most.
- Short-term + Momentary: 14px, secondary color
- Target delta indicator: small `(+0.2)` or `(-1.3)` in muted color showing difference from target
- When Integrated LUFS exceeds target: number turns `#C44030`
- When Integrated LUFS is within ±0.5 LU of target: number turns `#7FC8A0`

### True Peak LED

- Round LED, 8px diameter
- Green (`#4A7C6F`) when TP max is below ceiling
- Red (`#C44030`) when TP max exceeds ceiling — does not auto-reset, requires manual clear
- Numeric TP max readout alongside

---

## 7. Algorithm Style Selector

### Level 1: 3-option tile selector

At Level 1, three large tiles occupy the center control zone:

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ TRANSPARENT │  │   PUNCHY    │  │    LOUD     │
│             │  │             │  │             │
│  Preserves  │  │ Snap, edge, │  │  Maximum   │
│  dynamics   │  │   rhythm    │  │  loudness   │
└─────────────┘  └─────────────┘  └─────────────┘
```

Selected tile: `#28282E` background with `#5B8FC4` left border (3px) and `#E8E6E0` text.
Unselected: `#161619` background with `#2E2E36` border, `#52515A` text.

### Level 2+: 8-option selector

The full 8-algorithm selector appears as a horizontal scrollable pill group:

`[Transparent] [Punchy] [Dynamic] [Allround] [Aggressive] [Bus] [Safe] [Wall]`

Each pill: 80px wide, 28px tall, `Inter` 11px weight 500.
Active: `#5B8FC4` background, `#E8E6E0` text.
Hover: `#FFFFFF` 6% overlay.
Inactive: `#1E1E22` background, `#8A8890` text.

**Algorithm character descriptions** (shown as a tooltip on hover, or as a one-line subtitle below the selector):

| Algorithm   | Character                        | Best for                     |
| ----------- | -------------------------------- | ---------------------------- |
| Transparent | Clean ceiling, no color          | Classical, acoustic, any     |
| Punchy      | Preserves snap, slight edge      | Drums, rhythmic pop          |
| Dynamic     | Enhances transients pre-limiting | Rock, live recording         |
| Allround    | Balanced loudness + transparency | General mastering            |
| Aggressive  | Pushes hard, embraces coloring   | EDM, hip-hop                 |
| Bus         | Glue and pump                    | Drum bus, individual tracks  |
| Safe        | Zero distortion priority         | Delicate acoustic, classical |
| Wall        | Maximum ceiling enforcement      | Broadcast compliance         |

---

## 8. Saturation Section Visual Design (Level 3+)

The saturation section sits below the limiter controls and is visually separated by a 1px `#2E2E36` border + a 3px left accent bar in `#D4883A` (warm amber).

### Algorithm selector

Five pill buttons: `SOFT` · `HARD` · `TAPE` · `TUBE` · `FOLD`
Active pill: `#D4883A` background, `#0E0E10` text.
The amber accent communicates "warmth is active here."

### Transfer curve display (80×80px)

A mini x/y display showing the input/output transfer function of the selected saturation algorithm:

- Background: `#0E0E10`
- Grid lines: `#1E1E22` (subtle)
- 45° linear reference line: `#2E2E36` (dashed — represents "no saturation")
- Transfer curve: `#D4883A` (amber)

Visual character of each algorithm's curve:

- **Soft**: Smooth S-curve, gently rounds the top. tanh-shaped.
- **Hard**: Perfectly flat clip at a defined threshold. Sharp corner.
- **Tape**: Asymmetric S-curve. Top clips sooner than bottom. Has a slight "sag."
- **Tube**: Even-order harmonic emphasis. The curve bows upward in the middle before rounding off — distinct from Soft.
- **Fold**: The curve folds back on itself at the clip point — creates a V-notch wavefold shape.

### Drive Knob

Large knob (48px diameter). Range: 0 to +18dB.
Color ring around the knob: `#D4883A` → `#C44030` gradient as drive increases.
Numeric readout below: `+4.2 dB`

When Drive > 6dB: a small `HOT` label appears in `#C44030` below the drive value.

### Mix Knob

Smaller knob (36px). Range: 0–100%.
Controls parallel blend of saturated signal.
Numeric readout: `35%`

---

## 9. Streaming Platform Preset Selector

Located in the header bar as a dropdown: `[PRESET ▾]`

Opening it reveals:

```
STREAMING
  ● Spotify / Apple Music      -14 LUFS, TP -1.0 dBTP
  ○ YouTube                    -14 LUFS, TP -1.0 dBTP
  ○ Tidal                      -14 LUFS, TP -1.0 dBTP
  ○ Amazon Music                -14 LUFS, TP -2.0 dBTP

BROADCAST
  ○ EBU R128                   -23 LUFS, TP -1.0 dBTP
  ○ ATSC A/85 (US TV)          -24 LUFS, TP -2.0 dBTP

MUSIC PRODUCTION
  ○ CD Master                   -9 LUFS, TP -0.1 dBTP
  ○ Club / Dance                -8 LUFS, TP -0.3 dBTP
  ○ Hi-Fi Streaming            -12 LUFS, TP -1.0 dBTP

CUSTOM
  ○ Custom…                    (opens inline fields)
```

When a preset is selected:

1. The **Ceiling** value in the bottom bar updates to the preset's TP ceiling
2. A **target line** appears in the LUFS metering section
3. The **header preset label** shows the active preset name in muted text: `[Spotify -14 LUFS]`
4. The preset does **not** change the Gain slider or algorithm — it only sets the ceiling and target reference

---

## 10. Gain Slider (Left Strip)

The Gain slider is the primary "push" control — it determines how much gain reduction will occur.

**Appearance:**

- Vertical slider, full height of the plugin body (~280px in Standard size)
- Track: 4px wide, `#1E1E22` background
- Fill: gradient from `#5B8FC4` (bottom, no gain) → `#D4A847` (mid) → `#C44030` (top, heavy pushing)
- Thumb: 28×10px horizontal pill, `#E8E6E0`, with a subtle `#0E0E10` center notch
- Current value readout: floating label next to thumb: `+6.2 dB`

**Interaction:**

- Click + drag for coarse adjustment
- Scroll wheel: 0.1dB steps
- Ctrl/Cmd + drag: fine mode, 0.01dB steps
- Double-click thumb: type in exact value
- 0dB position is clearly marked with a tick and `0` label

**Context:**

- The gain slider is always visible regardless of complexity level — it is the most important single control in the plugin
- At 0dB: the plugin is acting as a transparent ceiling enforcer only
- As gain increases, the GR display comes alive

---

## 11. Bottom Bar (Always Visible)

The bottom bar spans the full width, height ~28px:

```
[CEILING: -0.3 dBTP] [TRUE PEAK: ●ON] [OVERSAMPLE: 4×] [DITHER: OFF] [UNITY GAIN] [RESET]
```

- **Ceiling**: Clickable field. Scroll to adjust in 0.1dB steps. Shows `dBTP` (True Peak) or `dBFS` depending on True Peak mode.
- **True Peak**: Toggle. Green LED when on. When off, shows `dBFS` in ceiling label.
- **Oversample**: Small dropdown. Off / 4× / 8× / 16× / 32×.
- **Dither**: Small dropdown. Visible at Level 2+. Hidden at Level 1.
- **Unity Gain** (`A=B`): Toggle. When active, automatically pads output to match input loudness for honest before/after comparison.
- **Reset**: Clears peak holds, GR history, LUFS statistics.

---

## 12. Delta Monitoring UX

Delta monitoring is discoverable at Level 3. Its design must be unmistakable — the user must never mistake the delta for the output.

**Discovery**: `[DELTA]` pill button in the Level 3 control zone. Tooltip on hover: _"Listen to only what the limiter is removing."_

**Active state changes:**

1. Waveform display background → `#1A0805` (dark red)
2. Waveform color → `#C44030`
3. Persistent banner at top of display: `◉  LISTENING TO GAIN REDUCTION ONLY`
4. Plugin header bar gets a red left border (4px, `#C44030`)
5. All other controls dim to 50% opacity — signalling "you are in a monitoring mode, not an output mode"
6. The LUFS meters show a `—` (not applicable) label since the delta signal doesn't have a meaningful loudness target
7. Output level meters show the delta signal's level

**Deactivation**: Click `[DELTA]` again, or press `Escape`. All states revert immediately.

The visual aggression of the delta state is intentional — it should feel like an alert, because accidentally leaving delta on while rendering would be catastrophic.

---

## 13. Animation & Motion Principles

### What animates in real-time (GPU-rendered, every frame)

- Waveform scrolling
- GR curve trace
- LUFS history line
- Output meters + GR meter (bar height)
- Peak hold tick positions
- Gain slider fill gradient
- GR peak label appearances

### What animates on user interaction (CSS transitions, 150ms)

- Level switching: control zone content fades in/out at 150ms
- Panel reveals (saturation section, multi-band view): 150ms fade
- Algorithm pill selection: color transition
- Preset dropdown: standard dropdown open/close

### What does NOT animate

- Numerical readouts (LUFS values, peak values) — must update instantly or feel laggy
- Ceiling field value
- True Peak LED (must fire instantly)
- Delta state change (must be instantaneous — this is a monitoring mode switch)

### Frame rate target

The waveform display must render at ≥60fps at standard window size. At large window size, target 60fps. Drop to 30fps only on compact size to save resources.

---

## 14. Control Design Reference

### Knob Standard

- Small knob (contextual controls): 32px diameter
- Medium knob (Lookahead, Attack, Release, Drive): 44px diameter
- Large knob (future use): 56px diameter
- All knobs: flat face, no gloss or 3D shading. A 3px arc track around the perimeter shows current value position.
- Track background: `#1E1E22`
- Track fill: `#5B8FC4` (limiter controls) or `#D4883A` (saturation controls)
- Value display: appears below the knob, `JetBrains Mono` 11px

### Interaction model (knobs)

- Click + drag vertically: adjust value
- Scroll: adjust in small steps
- Ctrl/Cmd + drag: fine mode
- Double-click: type value
- Right-click: context menu with "Set to default", "Enter value", "MIDI Learn"

### Threshold vs Ceiling Clarity

This is a perennial source of confusion. Crust resolves it:

- **Gain slider** (left) = "how hard to push into the limiter." This is the input gain.
- **Ceiling** (bottom bar) = "the maximum output level — the ceiling the output will never exceed."
- **Threshold** is not exposed at Levels 1–3 — the gain slider implies it. At Level 5, threshold can be shown separately in the Lab statistics panel for reference only.
- Tooltips on both controls explain the relationship clearly.

---

## 15. Reference Analysis — Lessons Incorporated

### FabFilter Pro-L 2

**What makes it best-in-class:**

- The scrolling waveform with layered input/output/GR makes limiting immediately visible and intuitive
- Peak GR labels at significant reduction events — directly adopted in Crust
- Advanced panel slide-out keeps the default view clean without burying controls in tabs
- Gain slider as primary control, not threshold knob — cognitively cleaner
- Unity Gain and Audition Limiting (delta) for honest comparison — both adopted

**What Crust improves on:**

- Progressive disclosure (5 levels vs. one panel slide-out)
- Integrated saturation section
- Streaming preset selector in the header

### Tokyo Dawn Limiter 6 GE

**What makes it excellent:**

- Modular, reorderable signal chain — users understand the processing order
- Each module has its own GR meter — granular feedback
- Collapsible modules reduce visual complexity
- Multi-stage philosophy (Compressor → Clipper → Peak Limiter → Output) is musically superior

**Adoption in Crust:**

- Level 5 multi-stage chain view exposes Clipper → Limiter → Ceiling stages with individual GR meters
- The philosophical insight (multiple gentle stages > one hard stage) informs the architecture

### iZotope Ozone Maximizer

**What makes it distinctive:**

- Transient/Sustain stereo independence split is a genuinely novel design for stereo unlinking
- Scrolling waveform with superimposed GR trace — adopted in Crust
- Learn Threshold (auto-set to LUFS target) — adopted as auto-gain in Crust
- Soft Clip pre-limiter as a user-facing option — adopted in Crust's saturation section
- IRC modes shown as clear named character modes — adopted in Crust's algorithm selector

### Youlean Loudness Meter

**What makes the metering excellent:**

- Three separate LUFS types (Integrated, Short-term, Momentary) displayed simultaneously with clear hierarchy
- Visual target indicator with colour coding (orange = below target, red = above target)
- Histogram view (distribution of LUFS over time) — relevant for Level 5 statistics panel
- Interactive loudness history graph where problem sections are immediately visible
- The vertical meter bar showing momentary (fill) + short-term (triangle pointer) in a single meter is elegant

**Adoption in Crust:**

- The LUFS readout hierarchy mirrors Youlean's structure
- The target delta indicator (`(+0.2)` / `(-1.3)` relative to target) is directly inspired by Youlean's colour feedback
- The LUFS history line in the waveform display serves the same purpose as Youlean's histogram view

---

## 16. Accessibility

- All interactive elements must have a minimum 28×28px hit target
- Colour is never the sole indicator of state — icons or text labels accompany all colour-coded states
- True Peak exceeded: LED changes colour AND shows numeric value in red AND shows `!` badge
- Delta mode: full visual overhaul, not just a button colour change
- Font sizes: minimum 10px for any label, 11px for readable control labels
- All knobs and sliders must be keyboard-focusable with arrow key adjustment

---

## 17. Implementation Notes for the Agent

**Rendering approach:**

- The waveform/GR display must use a `<canvas>` element with WebGL or 2D canvas for real-time rendering. Do not attempt to implement this in SVG or React component trees — it will not perform.
- All other UI elements are standard React components with Tailwind.
- The waveform renderer should be a standalone class/hook that receives a ring buffer of audio data from the DSP bridge and repaints at requestAnimationFrame.

**Component structure (suggested):**

```
<CrustPlugin>
  <PluginHeader />             // Level selector, preset, title
  <PluginBody>
    <GainStrip />              // Left — vertical gain slider
    <CenterPanel>
      <WaveformDisplay />      // Canvas — real-time scrolling display
      <ControlZone level={1|2|3|4|5} />  // Switches per level
    </CenterPanel>
    <MeteringStrip />          // Right — LUFS + output + GR meters
  </PluginBody>
  <BottomBar />                // Ceiling, TP, oversample, dither, unity gain
</CrustPlugin>
```

**State management:**

- Plugin parameters should live in a single flat store (Zustand or similar) with direct DSP bridge writes on change
- UI state (current level, display scroll speed, delta mode) is local React state
- LUFS and GR meter data flows from the DSP via a SharedArrayBuffer ring buffer — never via React state updates (too slow for 60fps metering)

**Canvas ring buffer pattern:**
The WaveformDisplay component should maintain:

- `inputRingBuffer[N]` — circular buffer of input samples (sub-sampled to display resolution)
- `outputRingBuffer[N]` — circular buffer of output samples
- `grRingBuffer[N]` — circular buffer of gain reduction values (in dB)
- `lufsRingBuffer[N]` — circular buffer of short-term LUFS values

N = display width in pixels × display history duration in seconds × sample rate (can be decimated heavily — 100 samples/sec is enough for smooth display).

**Knob implementation:**
Use a pointer capture approach (not drag events) for smooth knob interaction. The `onPointerDown` / `onPointerMove` / `onPointerUp` with `element.setPointerCapture(e.pointerId)` pattern gives the smoothest cross-platform feel.
