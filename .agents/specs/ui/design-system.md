# Design System — True-Black Skeuomorphic Interface

## Context

A true-black, skeuomorphic DAW interface requires a carefully layered surface hierarchy, pastel accent colors tuned for low eye strain, and tactile CSS techniques that simulate physical audio hardware. This spec synthesizes research across Bitwig Studio, Logic Pro, Ableton Live, and other professional DAWs into an actionable component library specification for Tailwind CSS and the shadcn/ui primitives we already use. The direction merges Bitwig's modern colorful dimensionality with Logic Pro's Apple-grade polish, rendered against a `#000` canvas using rim-lighting and gradient-edge techniques instead of traditional shadows.

This is the **foundational** design system. Per-plugin visual identity (color assignments, distinctive accent palettes per plugin) is specified in `plugin-identity.md`.

## Goal

After adoption, every Sourdaw surface uses the same token set (surface elevation, border tiers, signal colors, pastel accents, typography, spacing scale, rim-lighting rules) — so that adding a new panel, plugin, or control means pulling from the token set rather than hand-picking colors.

## Scope

**In scope:** surface color tokens, border/separator tiers, signal and state colors, pastel accent palette, skeuomorphic CSS techniques (rim lighting, gradient-edge, subtle luminance), interaction design patterns for mouse-first control, component inventory.

**Out of scope:**

- Per-plugin identity assignments — see `plugin-identity.md`.
- Layout primitives (`Stack`, `Row`, `Grid`) — see `layout-components.md` and `layout-components-migration.md`.
- Keyboard shortcut design.
- Accessibility guidelines beyond the contrast targets called out inline (future spec if needed).

## Acceptance criteria

- [ ] All tokens defined below are present in `src/main.css` under `@theme` variables.
- [ ] Every surface-color use in the codebase resolves through a CSS variable — no hard-coded hex in TSX.
- [ ] Contrast of every signal/state colour against `--surface-default` meets WCAG 2.1 AA (4.5:1 min).
- [ ] A storybook / component-gallery page demonstrates every token and skeuomorphic technique in one place.

---

## Color architecture for true black surfaces

The central challenge of a #000-based DAW UI is creating panel differentiation without visible box-shadows (which disappear against pure black). Professional DAWs solve this through **surface elevation via luminance steps** — higher panels are progressively lighter. Material Design recommends white overlays at increasing opacity on a `#121212` base; for true black, the principle is the same but shifted darker.

**Recommended surface hierarchy:**

| Token               | Hex       | Usage                                       |
| ------------------- | --------- | ------------------------------------------- |
| `--surface-deep`    | `#000000` | True black canvas, deepest recesses, bezels |
| `--surface-base`    | `#0A0A0A` | Main arrangement/timeline background        |
| `--surface-default` | `#111111` | Default panel backgrounds (mixer, browser)  |
| `--surface-raised`  | `#1A1A1A` | Raised elements: toolbars, floating panels  |
| `--surface-overlay` | `#242424` | Dropdowns, popovers, context menus          |
| `--surface-dialog`  | `#2E2E2E` | Modal dialogs, tooltips                     |

Borders and separators use three tiers: `#1A1A1A` (barely visible panel edges), `#2A2A2A` (standard borders), and `#383838` (emphasized dividers). On true black, **rim lighting replaces shadows** — a 1px `border-top` of `rgba(255,255,255,0.06)` and `border-left` of `rgba(255,255,255,0.04)` creates the illusion of a top-left light source, while `border-bottom` at `rgba(0,0,0,0.3)` grounds the element. Bitwig achieves its distinctive depth this way: clean vector panels that float above the dark canvas through subtle luminance shifts rather than heavy shadows. Logic Pro adds extremely subtle linear gradients (1–3% brightness variation top-to-bottom) and macOS vibrancy blur on sidebars.

**Signal and state colors** follow near-universal DAW conventions. Solo is amber/yellow (`#F7A738`), mute is orange-red (`#FF6446`), record arm is red (`#FF4032`), playback active is green (`#00FF81`), and selection is blue (`#4A90D9`). These values come directly from Ableton's theme XML files and are consistent across Logic Pro, Studio One, and most control surfaces. Cubase notably inverts solo/mute colors, but the industry standard is solo=yellow, mute=red.

**Pastel accent palette for meters, waveforms, and automation** — colors that read clearly against black without causing eye fatigue:

| Token             | Hex       | Usage                                 |
| ----------------- | --------- | ------------------------------------- |
| `--accent-blue`   | `#6BAACE` | Waveforms, selections, primary accent |
| `--accent-green`  | `#52BA46` | MIDI notes, safe meter zone           |
| `--accent-purple` | `#954EB2` | Sends, effects, sidechain routing     |
| `--accent-coral`  | `#FF5F80` | Automation curves, hot indicators     |
| `--accent-teal`   | `#4CB8B8` | Routing lines, secondary accent       |
| `--accent-amber`  | `#E0AA2A` | Highlighted parameters, modulation    |

Bitwig's color system is semantic — different colors represent different signal types (orange for generic input, distinct hues for modulation, automation, MIDI). Its custom Color Palette system extracts **27 colors from any dropped PNG/JPG image**, creating cohesive project-specific palettes. Logic Pro provides a curated **96-color grid** (24 hues × 4 brightness levels) pre-designed by Apple to harmonize with the gray UI. A DAW track color palette should offer **16 representative colors** spanning the spectrum: `#DC4848` (red), `#FF5F80` (coral), `#D66B18` (orange), `#E0AA2A` (amber), `#FFEC75` (yellow), `#AFB95B` (yellow-green), `#52BA46` (green), `#81D24C` (lime), `#4CB8B8` (teal), `#6BAACE` (sky blue), `#4881AA` (steel blue), `#3B5ECC` (blue), `#954EB2` (purple), `#B8CE93` (sage), `#A0A0A0` (gray), `#E7E6E6` (light gray).

**Typography** should use the system font stack for optimal rendering: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif` for UI text, and `"SF Mono", "Cascadia Mono", "JetBrains Mono", Consolas, monospace` for numerical displays. DAWs operate at remarkably small font sizes — **9px** for tiny labels and track numbers, **10–11px** for parameter values and default UI text, **12–13px** for section headers, and **18–24px** for transport displays (BPM, timecode). Ableton commissioned a custom typeface (Ableton Sans) from Letters from Sweden, designed with "spiralling round strokes" that embody turning a knob. For a web DAW, the system stack at **font-weight 500 (medium)** provides the best small-size legibility on dark backgrounds, where thin fonts become dangerously hard to read. Primary text should be `#E0E0E0` (not pure white, which causes excessive contrast on #000), secondary text `#999999`, and tertiary/disabled text `#666666`.

---

## Complete component inventory with design specifications

### Knobs and rotary encoders

Professional DAWs use three knob styles: **skeuomorphic 3D** (photorealistic, common in plugins like Universal Audio), **flat arc** (modern vector arcs dominant in Bitwig and Ableton's devices), and **dot-indicator** (minimal circle with position dot, common for pan controls). For this design system, a hybrid approach works best — a subtle 3D metallic dome body with a conic-gradient value arc.

The knob body uses layered radial gradients to simulate a metallic dome: a primary `radial-gradient(circle at 50% 40%, #555 0%, #333 40%, #1a1a1a 100%)` creates the base form, with a secondary `radial-gradient(ellipse 60% 40% at 50% 35%, rgba(255,255,255,0.25) 0%, transparent 70%)` adding a top-light reflection. The value arc wraps the knob using `conic-gradient(from 225deg, ...)` with a **270° sweep** (-135° to +135° from top dead center), masked to a ring shape with `mask: radial-gradient(circle, transparent 60%, black 61%)`. Three sizes cover all use cases: **24px** (channel strip sends/pans), **40px** (device parameters), and **72px** (featured plugin controls).

States include: default (base appearance), hover (subtle brightness increase + tooltip with parameter name and value), active/dragging (brighter fill + prominent value readout), disabled (40–50% opacity), and automated (colored overlay dot, typically coral/orange). **Magnetic snap points** at 0%, 25%, 50%, 75%, 100% are indicated by subtle tick marks around the arc and a small dead zone in the dragging logic. Pan knobs use a **center detent** with a bipolar arc that fills outward from center in both directions.

### Faders and sliders

Vertical mixer faders emulate the **100mm physical fader throw** standard, translating to approximately **160–200px** of track height in software. The fader track is a **4–6px wide inset groove** styled with `box-shadow: inset 0 1px 3px rgba(0,0,0,0.8)` and a base color of `#0A0A0A`. The fader cap uses a stacked linear gradient — `linear-gradient(180deg, #555 0%, #3a3a3a 30%, #333 50%, #2a2a2a 70%, #222 100%)` — with a center groove line (a 1px lighter stripe) and a `border-top-color: #666` for the metallic highlight edge.

The **dB scale** follows logarithmic spacing: markings at +12, +6, 0, -6, -12, -18, -24, -36, -48, -∞ dB, with **0 dB (unity gain) at roughly 70%** of the fader travel. Level meters run alongside the fader track, using the standard green-yellow-red gradient: green `#00CC44` (safe, up to -12dB), yellow `#CCCC00` (caution, -12 to -3dB), red `#FF3300` (clipping, above -3dB). Horizontal sliders follow the same visual language at **80–120px wide × 6px track height** for parameter adjustment.

### Toggle buttons with physical press states

The signature "sinking into the container" effect uses **inverted box-shadows**. An unpressed button gets `box-shadow: 0 2px 4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)` with a `background: linear-gradient(180deg, #2a2a2a, #1e1e1e)`. The pressed state inverts everything: `box-shadow: inset 0 2px 4px rgba(0,0,0,0.6), inset 0 1px 1px rgba(0,0,0,0.4)` with a reversed gradient `linear-gradient(180deg, #1a1a1a, #222)` and an optional `transform: translateY(1px)` to simulate physical depression. Solo buttons light up **amber** (`#F7A738`), mute buttons light **orange-red** (`#FF6446`), and record arm buttons light **red** (`#FF4032`), each with a matching colored glow: `box-shadow: 0 0 8px rgba(color, 0.4)`.

LED indicators use a simple but effective pattern: off state is a dark tinted dot (`#1A3A1A` for green LEDs), on state is the bright color with layered glow — `box-shadow: 0 0 4px #00ff66, 0 0 12px rgba(0,255,102,0.4), 0 0 24px rgba(0,255,102,0.15)`.

### Transport controls, meters, and displays

Transport buttons follow the universal icon set: play (▶ triangle, green when active), stop (■ square), record (● circle, red, pulses when armed), loop (↻ arrows, accent-colored when active), metronome (click icon). The transport bar spans the full width at the top, arranged as: `[◀◀ | ■ | ▶ | ● | ↻ | ♩] [BPM display] [Time signature] [Position: bars.beats.ticks]`. The BPM and position displays use monospaced font at **18–24px** with an LED-like aesthetic.

**Level meters** should implement digital peak metering with these ballistics: **near-instant attack** (0–5ms), **1.5–3 second exponential decay**, and a **peak hold indicator** (2px bright white line) that holds for 2 seconds before falling. The segmented LED look uses `repeating-linear-gradient(to bottom, transparent 0px, transparent 3px, #000 3px, #000 4px)` overlaid on the color gradient. Meter widths: **4–8px** per channel in channel strips, **12–20px** for master meters.

**Waveform displays** should use **Canvas** (not SVG) for performance — SVG causes massive DOM churn with thousands of path points. Audio waveforms render as filled shapes colored by track color, with a semi-transparent gradient overlay from center to peaks. At macro zoom, only the min/max envelope shows; at micro zoom, individual samples appear as connected dots. The waveform container gets edge fade with `linear-gradient(90deg, #0a0a0a 0%, transparent 3%, transparent 97%, #0a0a0a 100%)`.

### Piano roll, automation, and spectrum analyzers

Piano roll notes render as horizontal rectangles where width equals duration and vertical position equals pitch. **Velocity coloring** maps to saturation/brightness: high velocity (127) uses saturated bright colors, low velocity (0) uses dim/desaturated versions. The grid uses subtle gray lines (`#333` for beat divisions, `#555` for bar lines) on a `#1a1a1a` background, with scale-note rows optionally highlighted slightly brighter.

Automation curves display as line graphs with breakpoint nodes (4–8px circles), connected by linear or bezier curves. A semi-transparent fill (`alpha 0.15–0.3`) colored per parameter appears below the curve. Different automated parameters get distinct colors from the accent palette.

Spectrum analyzers use logarithmic frequency scaling (20Hz–20kHz on X-axis) with amplitude in dB on Y-axis. The gradient fill typically runs blue→cyan→green→yellow→red from bottom to top. Canvas rendering is mandatory for real-time performance.

---

## Panel-based layout architecture

### How professional DAWs organize panels

Bitwig Studio structures its UI into **three switchable views** — Arrange, Mix, and Edit — sharing a common header, transport area, and footer. The Arranger Timeline, Clip Launcher, Inspector, Device Panel, and Browser Panel can be independently toggled via icons beside the view buttons. Bitwig supports **Display Profiles** for multi-monitor setups (up to 3 screens) where panels distribute across monitors. Tab key toggles between Arrange and Mix views.

Logic Pro uses a **single main window with togglable zones**: Inspector (left, `I` key), Mixer (bottom, `X` key), Library/Browser (right, `Y` key), and Editors (bottom). It supports **Screensets** — saved window configurations recalled via number keys 1–9, commonly set as: 1=Main, 2=Mixer fullscreen, 3=Piano Roll fullscreen. Editors and mixer can also float as separate windows.

Ableton Live's **dual-view architecture** is unique: Session View (vertical clip grid) and Arrangement View (horizontal timeline) toggle instantly via Tab key. The browser sits left, the detail view (clip/device chain) sits bottom, and mixer sections can be toggled independently within each view. Cubase since v9 uses a **zone-based system**: Left Zone (Inspector + Visibility), Lower Zone (tabbed MixConsole/Editor/Sampler/Chord Pads), Right Zone (VSTi/Media/Control Room/Meter), with each zone independently togglable.

### Implementation patterns for the web

Panel dividers use draggable handles that change the cursor to a resize indicator on hover. **Minimum panel sizes** prevent layouts from collapsing (typically 150–200px minimum width for sidebars, 100px minimum height for bottom panels). Panel show/hide should be **instant** (not animated) — every major DAW prioritizes responsiveness over decoration for view switching, though smooth CSS transitions (100–150ms) can work for secondary panels.

For web implementation, **Dockview** (zero-dependency, supports React) and **Golden Layout** provide DAW-appropriate panel management: tabbed panel stacks, drag-and-drop repositioning, layout state serialization to localStorage, and floating/popout windows. The layout system should support named presets (screensets) stored as JSON objects containing panel visibility states, sizes, and positions.

Panel depth hierarchy on #000 relies on the surface elevation tokens above. The key technique is **gradient-edge borders** rather than box-shadows: a `::before` pseudo-element with `background: linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 50%, transparent 100%)` positioned behind the panel creates a subtle directional light edge that reads as elevation.

---

## Skeuomorphic CSS techniques that work on true black

### Metallic textures and brushed metal

The brushed metal effect uses three layers of `repeating-linear-gradient` at 90° with different periodicities to create pseudo-random fine lines: alternating white stripes at 0.04 opacity over 1–2px periods, black stripes at 0.03 opacity over 3px periods, and white stripes at 0.02 opacity over 5px periods, all layered over a base `linear-gradient(180deg, #3a3a3a 0%, #2a2a2a 50%, #333 100%)`. For the "silky" feel, the trick is **extremely subtle gradients** (1–3% brightness variation) combined with anti-aliased edges, generous `border-radius` (4–8px), and easing transitions of **150–300ms** on hover states. Noise texture at 2–3% opacity over solid dark colors prevents color banding and adds analog warmth.

A dark aluminum panel surface uses: `background: linear-gradient(135deg, rgba(255,255,255,0.03) 0%, transparent 50%, rgba(0,0,0,0.05) 100%), linear-gradient(180deg, #1c1c1c, #161616)` with asymmetric borders — `border-top: 1px solid #333; border-bottom: 1px solid #111`.

### Consistent lighting model

All elements should follow a **top-left (315°/northwest) light source**. This means:

- Top and left edges of every raised element get a lighter border (`rgba(255,255,255,0.05–0.1)`)
- Bottom and right edges are darker or have no highlight
- Knob dome reflections concentrate at the upper-left quadrant
- Inset elements (pressed buttons, fader grooves) reverse this — darker top-left, lighter bottom-right

Define these as CSS custom properties: `--light-edge: rgba(255,255,255,0.08)`, `--shadow-edge: rgba(0,0,0,0.3)`, and apply them consistently across every component. Active/selected states add a **soft colored glow**: `box-shadow: 0 0 8px rgba(accent,0.3), 0 0 16px rgba(accent,0.1)`.

### Tailwind CSS configuration

The shadcn/ui setup requires overriding CSS variables in `globals.css` and extending the Tailwind theme with DAW-specific tokens. Custom utilities streamline component development:

```css
@utility panel-raised {
    background: var(--surface-default);
    border: 1px solid var(--border-subtle);
    border-top-color: var(--border-bright);
}

@utility channel-inset {
    box-shadow:
        inset 0 1px 3px rgba(0, 0, 0, 0.8),
        0 1px 0 rgba(255, 255, 255, 0.04);
}

@utility glow-active {
    box-shadow:
        0 0 4px var(--glow-color),
        0 0 12px color-mix(in oklch, var(--glow-color), transparent 60%);
}
```

shadcn components should be modified directly (it's copy-paste, not a dependency). Replace the default Slider with a custom audio fader. Extend Toggle with the inverted box-shadow pressed states. Use `data-[state=on]` selectors in Tailwind v4 for state-dependent styling. Performance-critical elements (meters, knobs during drag, playhead) should use `will-change: transform` and `contain: layout style paint` to isolate repaints.

---

## Interaction design patterns for mouse-first control

### Drag mechanics and sensitivity

Knobs should use **vertical drag** (not circular) — this is the overwhelming industry standard established by JUCE (the dominant audio UI framework). Dragging up increases value, down decreases. The cursor should **hide during drag** using the Pointer Lock API, then restore position on release. This prevents the cursor from flying off-screen and enables unlimited drag distance. **Normal sensitivity maps 200–300px of vertical mouse movement to the full parameter range.** Shift+drag enters fine mode at a **4:1 to 10:1 ratio** (800–3000px for full range).

Faders use **relative motion** (not jump-to-click-position) — clicking the fader track moves the thumb relative to its current position, preventing accidental jumps. The **drag threshold is 3–5px** of movement before any drag begins, preventing accidental adjustments on click.

### Modifier key conventions

The design system should support these cross-DAW standards:

- **Shift + drag**: Fine/precise adjustment (universal across all DAWs)
- **Double-click**: Reset to default value OR open text input for exact value entry (support both — detect if the user starts typing)
- **Alt/Option + click**: Reset to default (AAX/AudioUnit convention)
- **Ctrl/Cmd + click**: Alternative — some DAWs use this for reset, others for text input
- **Scroll wheel on hover**: Adjust in small increments (~1–2% of range per tick; Shift+scroll for 0.1–0.5% per tick)
- **Escape**: Cancel value entry; **Enter**: confirm

There is **no universal standard for reset-to-default** — Ableton uses Delete, Bitwig uses double-click, Pro Tools uses Alt+click. Supporting both double-click and Alt+click covers the widest user base.

### Hover states and visual feedback

Parameter hover should trigger an **instant update** to a status bar (like Ableton's Info View) showing "Parameter Name: Value Unit" with zero delay. Floating tooltips appear after **300–500ms** hover delay. During active adjustment, the value display should be always visible near the control. Meter ballistics follow strict standards: VU meters use **300ms symmetrical attack/release**, digital peak meters use **near-instant attack with 1.5–3 second exponential decay**. Implement meter smoothing with: `displayValue += (targetValue - displayValue) * smoothingFactor` where attack factor is ~0.3–0.5 and release factor is ~0.005–0.01.

### Context menus and keyboard shortcuts

Right-click on a knob/fader should offer: Set to Default, Type In Value, Copy Value, Paste Value, Assign MIDI Controller, Show Automation Lane. Right-click on a clip: Cut, Copy, Paste, Duplicate, Delete, Rename, Color, Split, Reverse, Quantize. Space bar universally toggles play/stop. When text input is active, **single-letter shortcuts must be disabled** — only modifier+key shortcuts should fire. Critical keyboard shortcuts: Cmd/Ctrl+Z (undo), Cmd/Ctrl+S (save), Cmd/Ctrl+D (duplicate), Z (zoom to selection), Tab (view switching), and 1–9 for screenset recall.

---

## Conclusion: a design system that sounds as good as it looks

Three principles should guide every component decision. First, **depth through light, not shadow** — on a #000 canvas, elevation is communicated through progressively lighter surfaces and rim-lighting borders, not box-shadows that vanish into the void. The six-level surface hierarchy from `#000000` to `#2E2E2E` provides all the visual separation needed. Second, **tactile feedback through state inversion** — buttons that physically sink via inverted gradients and box-shadows, knobs that reveal metallic dome reflections, and LED indicators with multi-layered glow all create the perception of touching real hardware. Third, **information through color semantics** — solo is always amber, record is always red, meters always run green-yellow-red, and automation curves are always distinguishable by hue. These conventions are deeply ingrained in audio professionals' muscle memory.

The most impactful implementation priorities are: the surface elevation system (it defines the entire visual identity), the knob component (it appears hundreds of times in a DAW session), and the vertical drag + pointer lock interaction model (it makes every parameter feel professional). Bitwig's approach to "modern skeuomorphism" — dimensional but clean, colorful but vector-based — is the ideal reference point for balancing visual richness with web performance constraints. Build the Canvas-based visualizations (meters, waveforms, spectrum analyzers) as standalone modules outside React's render cycle, and keep all real-time audio state in refs rather than React state to avoid frame drops.
