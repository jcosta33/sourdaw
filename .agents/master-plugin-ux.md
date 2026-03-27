# Master Synth UI/UX Specification

## Core UI philosophy

The synth should feel like **one instrument with layers of depth**, not a modular lab glued together from unrelated views.

The UI must satisfy 4 goals at once:

1. **Beginners can play and shape sound immediately**
2. **Intermediate users can build layered patches without getting lost**
3. **Experts can access routing, modulation, and analysis fast**
4. **The whole thing stays visually coherent no matter how deep the patch gets**

The central rule:

> Complexity is always available, but never forced.

The synth should unfold like this:

- **Level 1: Play**
- **Level 2: Shape**
- **Level 3: Build**
- **Level 4: Route**
- **Level 5: Lab**

These are not separate products or modes in the engine.  
They are **visibility layers in the same patch format**.

---

## The overall layout

Use a stable 5-zone layout so the user always knows where things live.

### 1. Top bar

Persistent across all levels.

Contains:

- preset browser
- save / duplicate / compare
- undo / redo
- patch tags / notes
- complexity level switcher
- quality status
- CPU / voice meter
- share / copy preset link
- help / onboarding access

Purpose:

- global actions
- system status
- safe orientation point

### 2. Macro strip

Directly below the top bar.

Contains:

- 8 macro knobs minimum
- optional XY pad
- patch-level performance controls
- macro labels that are musical, not technical

Examples:

- Brightness
- Motion
- Width
- Dirt
- Space
- Punch

Purpose:

- this is the **beginner safe zone**
- a noob should be able to browse presets and get meaningful control without opening internals

### 3. Left panel: Layer Stack

This is the main structural view.

Contains:

- layer list
- add layer
- duplicate / mute / solo / freeze / bounce layer
- drag reorder
- color coding
- per-layer icon for engine type or hybrid type

Each layer is a musical object first, not a DSP object first.

A layer can contain:

- one or more generators
- its own filter block
- its own insert chain
- sends to global lanes
- its own modulation targets

Purpose:

- patch structure stays readable
- user always sees “what exists” before “how it is wired”

### 4. Center panel: Context Inspector

This is the most important panel.

It always shows details for the currently selected thing:

- preset macro overview
- layer
- generator
- filter
- FX lane
- modulator
- routing view
- import/resynthesis process
- morph process

Purpose:

- avoid giant knob walls
- keep one stable focus surface
- let detail follow selection

### 5. Bottom dock: Modulation Dock

Always anchored at the bottom.

Contains:

- envelopes
- LFOs
- MSEGs
- step sequencers
- random sources
- macros
- audio followers
- performance inputs
- MPE controls

Purpose:

- all modulation lives in one predictable place
- “modulate upward” becomes the core mental model

### 6. Right panel: FX / Routing Panel

Dedicated to:

- lane routing
- insert chains
- sends
- serial / parallel / split structure
- global FX overview
- per-voice FX toggles
- lane meters

Purpose:

- keep sound generation and sound processing visually distinct

---

## Progressive disclosure: how the synth unfolds

## Level 1 — Play

This is the default first-run view.

Visible:

- preset browser
- macro strip
- XY pad if assigned
- master output meter
- one simplified “Tone / Motion / Space” strip
- keyboard input visualizer
- very basic oscilloscope

Hidden:

- generator stack internals
- routing
- modulation dock details
- advanced filter pages
- FX chains
- all resynthesis / import detail

User goal:

- load sounds
- tweak them musically
- never feel punished by complexity

Rules:

- only musical labels
- no terms like serial, bipolar, comb, algorithm, spectral spread, etc.
- every control should make an obvious audible change
- every patch should ship with useful macros

This is the “I opened it and it already sounds good” layer.

---

## Level 2 — Shape

This is for users making or editing a patch without needing architecture.

Visible:

- selected layer summary
- one main generator panel
- amp envelope
- one filter
- one or two visible modulation sources
- one insert FX preview strip
- macro strip remains visible

Still hidden by default:

- deep routing
- multi-lane topology
- complex mod management
- full per-layer mixer view

User goal:

- start from init
- make a bass, lead, pad, pluck, texture
- understand one sound source clearly

Rules:

- only show the selected layer
- use large high-value controls first:
    - waveform / source type
    - filter cutoff / resonance
    - envelope amount
    - unison
    - drive
    - stereo width
- advanced parameters live behind small disclosure groups

This is the “I want to design a sound, not architect a system” layer.

---

## Level 3 — Build

Now the synth becomes visibly multi-layer and modular.

Visible:

- full layer stack
- add generator inside layer
- add layer from template
- per-layer mixer controls
- full modulation dock
- filter and insert blocks per layer
- more detailed visualizers

User goal:

- combine engines
- create layered sounds
- add motion and complexity
- understand patch composition

Rules:

- creation should be template-driven first

Examples:

- Add Wavetable Layer
- Add Analog Layer
- Add FM Layer
- Add Granular Texture
- Add Sampler Layer
- Add Resynth Layer

Each template should:

- create sensible defaults
- preload common routings
- expose only the important first controls

Do not drop users into a blank technical module list first.
Default action should be **musical intent first**, technical details second.

---

## Level 4 — Route

This is where architecture becomes explicit.

Visible:

- lane routing map
- serial / parallel / split toggles
- filter routing
- per-layer sends
- audio-rate modulation routes
- per-voice FX placement
- lane meters and signal path highlighting

User goal:

- deliberately shape the signal path
- build unusual interactions
- understand how sound flows

Rules:

- signal path must be visually traceable
- selecting any node highlights:
    - what feeds it
    - what it feeds
    - what modulates it
- hover should preview route paths
- route edits must feel reversible and safe

The routing UI should behave like a **guided graph**, not a spaghetti patcher.

It should not be fully free-cable modular.
It should be **semi-constrained** so users get power without chaos.

---

## Level 5 — Lab

This is the high-complexity surface.

Visible:

- unified import / analysis workflows
- wavetable editor
- additive editor
- granular source editor
- morph engine
- AI-assisted preset morph controls
- MPE calibration / curves
- deep modulation audit panel
- parameter diff / compare tools
- advanced analysis visualizers

User goal:

- invention
- system-level experimentation
- sound research

Rules:

- every heavy or destructive action needs status feedback
- every multi-step process must show progress and be cancelable
- every result should be previewable before commit where possible

Lab is where the synth becomes “the mother of all plugins,” but it must remain quarantined from the beginner path.

---

# Main interaction model

## 1. Selection drives detail

The interface should be selection-based, not page-based.

When the user clicks:

- a layer → inspector shows layer overview
- a generator → inspector shows generator controls
- a filter → inspector shows filter editor
- an LFO → inspector shows LFO editor
- an FX lane → inspector shows lane content
- a routing node → inspector shows route parameters

This keeps the workspace stable while depth unfolds naturally.

---

## 2. The left side answers “what exists”

The layer stack is always the source of truth.

It should answer:

- how many layers exist?
- what type are they?
- which one is selected?
- which are audible?
- which are frozen / bounced?
- which have warnings / pending analysis / disabled modules?

Each row should show:

- layer color
- name
- engine badges
- level meter
- mute / solo
- quick freeze / bounce
- complexity badge if layer is advanced

This makes the patch readable before it is editable.

---

## 3. The center answers “what am I working on”

The inspector must always prioritize the most important controls first.

Structure every inspector page like this:

### Header

- object name
- object type
- bypass
- duplicate
- reset
- favorite
- help hint

### Primary controls

The 4–8 controls that matter most for sound

### Secondary controls

Grouped into collapsible sections

### Advanced controls

Collapsed by default except in Route or Lab

This structure should apply to every object in the synth.

---

## Generator UX

## Generator model

Use **Layer > Generator(s)** as the hierarchy.

This prevents immediate overwhelm.

A beginner thinks:

- “this is my bass layer”

An expert can still open that layer and see:

- wavetable generator
- noise generator
- FM mod generator
- sampler transient generator

The layer abstraction makes power readable.

---

## Adding sound sources

When clicking “Add Layer,” show a visual chooser with musical outcomes first:

- Analog
- Wavetable
- FM
- Granular
- Sampler
- Additive
- Noise
- Hybrid
- From Audio

Each card shows:

- a one-line description
- what it is good for
- a starter template

When clicking “Add Generator” inside a layer, show the technical version.

That means:

- noobs add layers
- advanced users add generators inside layers

This split is critical.

---

## Generator inspector design

Every generator should share one common header format:

- source type
- on/off
- level
- pan
- pitch
- unison
- route target

Then each generator gets a custom body.

### Wavetable generator

Visible first:

- wavetable view
- position
- warp
- unison
- blend
- phase mode

Advanced:

- frame editor
- import options
- spectral ops
- mip / anti-alias controls

### Analog generator

Visible first:

- waveform
- octave / semitone
- pulse width
- sync
- sub
- drift

Advanced:

- anti-alias mode
- phase reset behavior
- detailed unison spread

### FM generator

Visible first:

- algorithm
- ratio
- amount
- feedback
- operator mix

Advanced:

- per-operator waveforms
- envelopes
- matrix
- key scaling
- operator phase / detune detail

### Granular generator

Visible first:

- sample display
- position
- density
- size
- spray
- pitch variation

Advanced:

- grain window
- stereo grain behavior
- random distributions
- scrub behavior

### Sampler generator

Visible first:

- sample / zone overview
- root note
- start / end
- envelope
- playback mode

Advanced:

- zones
- velocity layers
- round robin
- keyswitches
- stretch / transient handling

### Additive generator

Visible first:

- partial energy display
- brightness / tilt
- harmonicity
- resynth amount

Advanced:

- partial editor
- phase editor
- resynthesis cleanup
- frequency locking
- partial grouping

---

# Modulation UX

## Core principle

Modulation should feel like **direct manipulation**, not spreadsheet programming.

Best model:

- drag source
- hover destination
- hear preview
- drop to assign
- adjust ring depth directly on target

This should be the default modulation interaction.

---

## Modulation surface structure

### Bottom dock

Each modulator appears as a card with:

- name
- shape mini-preview
- mono/poly badge
- active targets count
- color
- quick mute / solo

Clicking a modulator opens its editor in the center inspector.

### Target controls

Every modulatable knob should show:

- subtle empty ring when modulatable
- colored ring when assigned
- multiple arc segments for multiple sources
- hover state that lists sources
- click-to-open modulation summary

### Modulation summary popover

Every target should support:

- what affects this?
- source list
- amount
- polarity
- smoothing
- mono/poly
- remove mapping

This prevents hidden complexity.

---

## Modulation levels by user depth

### Beginner

Only sees:

- LFO 1
- Env 2
- Macro assignments
- one simplified “motion” area

### Intermediate

Sees:

- full mod dock
- drag-drop assignments
- basic source settings

### Expert

Sees:

- source transforms
- remap curves
- modulation stacking
- audio-rate sources
- target conditions
- per-voice vs global scope
- advanced audit table

---

## Modulation list / audit panel

There should be a dedicated optional side panel for experts:

Columns:

- source
- target
- amount
- polarity
- mono/poly
- smoothing
- note scope
- enabled state

This is not the primary interaction model.
It is the **debug / audit / bulk edit model**.

That distinction matters.

---

# Filter UX

Filters should be presented in two layers:

## Simple view

- filter type
- cutoff
- resonance
- drive
- mix

## Expanded view

- slope
- model
- morph
- key tracking
- modulation depth summary
- nonlinear mode
- routing placement

Two filter slots should exist visually as:

- Filter A
- Filter B

And routing between them should be represented with:

- Series
- Parallel
- Split

This should be selectable with large visual toggles, not small hidden dropdowns.

---

# Effects UX

## FX structure

Use:

- per-layer inserts
- three global lanes
- optional per-voice processing toggle where relevant

Visually:

- right panel = FX world
- lane cards stacked vertically
- modules shown as reorderable blocks

Each lane block shows:

- lane name
- routing mode
- wet level
- meter
- bypass
- per-voice toggle if enabled

Each effect block shows:

- icon
- name
- 2–3 key knobs
- expand button
- drag handle
- bypass
- delete

The small version must be enough for quick edits.
The expanded version opens in the center inspector.

---

## FX lane interaction rules

- drag modules to reorder
- drag across lanes to move
- right click or long press for duplicate / convert to preset / save chain
- hover any lane to preview signal path highlight
- selecting a layer should show how much it contributes to each lane

This solves the common “where is my sound going?” problem.

---

# Routing UX

Routing is where complex synths usually become unreadable.

So:

- never expose routing as raw technical text only
- always pair routing controls with a visual path

## Routing view should show:

- generators
- filters
- per-layer inserts
- lane sends
- master
- sidechain / followers if applicable

It should behave like a structured node map, not a free patch cable canvas.

Allowed routing changes should be constrained and legible.

Examples:

- move generator before/after filter
- send layer to lane 1 + lane 3
- split filter A and filter B
- process lane 2 in parallel
- enable per-voice FX for lane 1

Every route change should immediately update a visual flow line.

---

# Visual feedback system

The synth should feel alive, but visuals must explain sound, not just decorate it.

## Always-on visual layers

- output meter
- basic oscilloscope
- modulation rings
- selection highlighting
- voice / CPU / quality status

## Contextual visual layers

Shown when relevant:

- wavetable display
- filter response curve
- envelope/LFO playback cursor
- spectrum analyzer
- grain cloud
- additive partial graph
- FM operator graph
- route activity highlighting

## Rules for visuals

- visuals should support the currently selected object
- avoid showing all analyzers at once
- one large relevant visualization is better than five tiny ones
- the center panel visual should always correspond to selection

This prevents “dashboard syndrome.”

---

# Beginner onboarding

## First-run experience

On first launch, show 3 choices:

- Play Sounds
- Build a Patch
- Open the Full Instrument

### Play Sounds

Drops user into Play level with macro-rich presets

### Build a Patch

Starts a guided init patch flow:

- choose sound family
- choose engine
- choose character
- land in Shape level

### Open the Full Instrument

For advanced users who want everything immediately

---

## Guided empty-state flows

If the synth is empty, the UI should not show blank tech panels.

It should show actionable cards:

- Start with Analog
- Start with Wavetable
- Drag in Audio
- Load Preset
- Build Layer Stack
- Open Tutorial Patch

This is much better than a dead modular shell.

---

## Inline education

Use inline explanations, not a giant manual-first strategy.

Examples:

- hovering “Comb” explains what it sounds like
- hovering a mod ring explains what colors mean
- selecting “Per-Voice FX” warns about sonic effect and cost
- dragging audio into the synth opens clear choices:
    - make wavetable
    - make granular source
    - make sampler layer
    - make resynth layer
    - do all

The system should teach through interaction.

---

# Expert fast paths

Experts should never be slowed down by the beginner layer.

They need:

- keyboard search for any module or function
- slash-command style quick add
- right-click menus everywhere meaningful
- duplicate layer / duplicate chain / duplicate modulator
- alt-drag to copy assignments
- shift-drag for fine control
- command-click to pin inspector
- quick compare A/B
- favorite modules and starter chains
- hotkey to reveal full routing
- hotkey to show all modulation affecting current selection
- hotkey to bounce selected layer

The UI must support speed without making that speed mandatory.

---

# Bounce / freeze / commit workflow

Because this synth is allowed to be heavy, the bounce workflow should be first-class.

## Every layer row should have:

- freeze
- bounce
- unfreeze / restore source
- replace / keep source toggle

## Bounce options

Simple labels:

- Instrument Only
- Instrument + Layer FX
- Full Output

Optional advanced labels under disclosure:

- pre-insert
- pre-send
- post-FX
- post-master-lane

## After bounce

The UI should make it obvious that:

- the source patch still exists
- the audio is now committed
- editing can be resumed
- re-render is available

This workflow should feel native to the synth, not bolted on.

---

# State and status model

The synth must always make invisible states visible.

Show status for:

- draft vs render quality
- active polyphony
- heavy modules
- pending analysis
- incomplete resynthesis
- AI morph in progress
- frozen / bounced layers
- disabled modules
- missing browser capabilities if applicable on web
- unsaved preset changes

Never let the user wonder:

- why it sounds different
- why something is greyed out
- whether a process finished
- what is currently active

---

# Color and labeling system

Use color systematically.

## Recommended semantic color model

- each layer gets a soft identity color
- each modulation source gets a distinct color
- mono modulation and poly modulation use clearly different visual treatment
- destructive or heavy states use warning tones
- bypassed / frozen states are visibly muted

Avoid using color only decoratively.
Color must always communicate structure or state.

## Labeling rules

Prefer musical language at the top layer:

- Brightness
- Punch
- Space
- Motion
- Dirt
- Body

Use technical terms only when the user is already in deeper layers.

This avoids scaring beginners while preserving expert precision.

---

# Responsive / scaling behavior

At large sizes:

- full 3-column layout plus bottom dock

At medium sizes:

- right FX panel collapses into tabbed drawer
- bottom mod dock becomes shorter with horizontal scroll

At small sizes:

- left and right sidebars become toggled drawers
- center inspector remains dominant
- macros remain pinned at top

The center inspector must always win.
If space gets tight, secondary panels collapse first.

---

# Default patch strategy

The UI cannot succeed if the default patches are bad.

Every patch should include:

- useful macros
- clean labels
- sensible layer names
- one obvious visual focus
- beginner-friendly entry point

A preset should be explorable without reading documentation.

Factory patches should also be categorized by complexity:

- Play
- Shape
- Build
- Route
- Lab

That way users can learn the instrument by browsing patches of increasing depth.

---

# The key mental model

The synth should teach this mental model:

1. **A patch contains layers**
2. **A layer contains generators and processors**
3. **Modulators live at the bottom and reach upward**
4. **Effects live on the right**
5. **The center always shows what you selected**
6. **You only reveal more complexity when you want it**

If this mental model is preserved everywhere, the synth can become extremely deep without becoming hostile.

---

# Final UX position

This plugin should not present itself as:

- a modular science lab
- a giant wall of expert knobs
- a “do everything at once” interface

It should present itself as:

> a musical instrument that opens into a laboratory only when you ask it to

That is the correct UI strategy for a true mother-of-all synth.

---

# One-sentence product UX summary

**The perfect UI is a layered, selection-driven synth workspace where beginners live in macros and shaping, intermediates build with layers, experts route and modulate at full depth, and nobody is forced to look at complexity before they need it.**
