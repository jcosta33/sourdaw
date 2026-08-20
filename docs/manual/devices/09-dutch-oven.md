# Dutch Oven — Reverb

Dutch Oven is a reverb. Reach for it when a track or bus needs a space around it — a hall, a room,
a plate, a spring, or a reverse build-up. A saturation stage and a vintage colour sit on the output
and are off, or Modern, until you change them.

The panel is labelled **Reverb stage**. The device opens on **Plate**, with **Hall** highlighted in
the space tray.

**Type** Audio effect · **Category** Reverb · **Load from** Sidebar → Effects → Dutch Oven

## At a glance

- Five algorithms: **Plate**, **FDN 8**, **FDN 16**, **Spring**, **Reverse**.
- Eight space rows that load a starting point for the main knobs.
- Mix, decay, pre-delay, size, tone cuts, modulation, and an optional shimmer and saturator.
- A Decay EQ overlay on the spectrogram, and a Flow view of the path.

## First moves

1. Add Dutch Oven to a track or bus and play material through it.
2. Raise **Mix** if the space is too quiet — it starts at 30% wet.
3. Click a row in **Space tray** if you want a starting point; a fresh insert highlights **Hall**
   without loading that row's knobs until you click it.
4. Leave **Algorithm** on **Plate** until you know you want a different engine. Switching keeps the
   other values; some knobs go grey.

## Algorithm

Algorithm is the first choice, not a flavour applied afterwards. Each one is a different reverb,
and each one reads a different subset of the knobs. The ones it does not read stay in place and go
grey, and hovering one tells you which algorithm cannot hear it and why — so the layout never
shifts under you when you switch, and a knob that does nothing is never mistaken for a knob that is
broken. Greying refuses your hand only: automation lanes, saved values, and anything already drawn
are untouched.

The Flavor card badges the selection **A1** through **A5** in chip order, not as an engine number.

| Algorithm   | What you get                                                                 |
| ----------- | ---------------------------------------------------------------------------- |
| **Plate**   | The default. A tank with early reflections, freeze, shimmer, and saturation. |
| **FDN 8**   | An eight-delay network. Decay reads in seconds.                              |
| **FDN 16**  | A sixteen-delay network. Decay reads in seconds.                             |
| **Spring**  | A spring tank. The **Spring** space row also switches to this.               |
| **Reverse** | A reverse build-up. Mono: both sides carry the same signal.                  |

Every algorithm ignores something, and the table above only lists what each one _is_. Stated the
other way round, because a greyed control needs a page to look it up on:

| Algorithm              | Ignores                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Plate**              | Nothing on the knobs. **Decay EQ** is silent while **Freeze** is on, and at **Decay** 0.999.                               |
| **FDN 8** / **FDN 16** | Rate, Diffuse, Freeze, Shimmer (and Amount and Pitch), Gravity, the saturation curve, Density                              |
| **Spring**             | Pre, Rate, Freeze, Shimmer, Gravity, Saturation, the saturation curve, Density, E/L                                        |
| **Reverse**            | Damp, Pre, Rate, Depth, Diffuse, Width, Freeze, Shimmer, Gravity, Saturation, the saturation curve, Density, E/L, Decay EQ |

On **FDN 8** and **FDN 16**, the **Saturation** switch still works; only the **Tanh / Cheby / Clip**
chips are ignored.

> [!WARNING]
> **Not yet active** on **FDN 8**, **FDN 16**, **Spring**, and **Reverse** for the ignored controls
> that could apply to that algorithm. They stay on screen, remember their values, and do not change
> the sound. Hover the control: if it "does not apply", that algorithm has no such stage; if it is
> "not implemented yet", the stage is missing.

Picking an algorithm writes only the algorithm. It does not reset Mix, Decay, or the rest.

## Space tray

Eight rows, each with a short mood line. Clicking a row loads a starting point for **Size**,
**Decay**, **Damp**, **Diffuse**, **Depth**, and **Pre**. **Shimmer** also turns **Shimmer** on.
**Spring** also switches **Algorithm** to **Spring**. **Infinite** pushes **Decay** to the top of
the Plate range, which silences **Decay EQ** until you turn Decay down.

A new device highlights **Hall** and **Live**, and still uses the module defaults below until you
click a row. Clicking **Hall** then writes a longer decay and a 20 ms pre-delay, which is not what
the fresh insert was already doing.

Space itself has no automation lane. The knobs it writes do.

## Flavor

| Control                                       | Range         | Default    | What it does                                                                                                                                                  |
| --------------------------------------------- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Modern · 80s · 70s**                        | those three   | **Modern** | Output colour. **80s** and **70s** change bandwidth and noise on the whole output, not only the wet. The same three chips sit under **Vintage** in Character. |
| **Plate · FDN 8 · FDN 16 · Spring · Reverse** | those five    | **Plate**  | Which reverb runs. The same chips sit in Engine.                                                                                                              |
| **Decay EQ**                                  | view on / off | off        | Opens the six-band overlay on the spectrogram. A view toggle: it does not write a parameter.                                                                  |
| **Flow**                                      | view on / off | off        | Opens a picture of the path. A view toggle.                                                                                                                   |
| **Freeze**                                    | On / Off      | Off        | Holds the tank. See Switches.                                                                                                                                 |
| **Shimmer**                                   | On / Off      | Off        | Pitch in the loop. See Switches.                                                                                                                              |
| **Saturation**                                | On / Off      | Off        | Output saturator. See Switches.                                                                                                                               |

## IR tray

Drag a WAV, AIFF, or FLAC onto the tray. The tray shows the file name and a waveform preview.

> [!WARNING]
> **Not yet active.** The tray remembers the preview. It does not change the reverb. There is no
> convolution chip on **Algorithm**.

## Core

The heading **Control deck** sits above these four cards. The same Mix, Decay, Pre, and Width
values appear as tiles in the **Reverb stage** header.

| Control   | Range       | Default | What it does                                                                                                                                                                                                             |
| --------- | ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Size**  | 0 to 100%   | 75%     | How large the space reads. On **Plate**, this spaces the early reflections; the tank delays stay put.                                                                                                                    |
| **Decay** | 0 to 0.999  | 0.500   | How long the tail lasts. **Plate** and **Spring** show the coefficient. **FDN 8** and **FDN 16** show seconds (~1.7 s at the default, up to ~29.8 s at the top). **Spring** stops the knob at 0.95; **Reverse** at 0.99. |
| **Mix**   | 0 to 100%   | 30%     | Wet against dry.                                                                                                                                                                                                         |
| **Pre**   | 0 to 500 ms | 15 ms   | Delay before the reverb. Grey on **Spring** and **Reverse**.                                                                                                                                                             |

On a new **Plate**, **Size** already reads 75%, but the early reflections are still the 50% room
until Size is written — moving the knob away and back, or writing 75% from an automation lane,
changes the sound.

## Tone

| Control     | Range         | Default | What it does                                                                                                                 |
| ----------- | ------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Hi Cut**  | 1.0k to 20.0k | 12.0k   | Low-pass on the output. The readout drops "Hz" and prints `k` above 1 kHz.                                                   |
| **Lo Cut**  | 20 to 1000 Hz | 80 Hz   | High-pass on the output.                                                                                                     |
| **Damp**    | 0 to 100%     | 30%     | High frequencies die faster in the tail as you raise it. Grey on **Reverse**. **Spring** stops the knob just shy of the top. |
| **Diffuse** | 0 to 100%     | 75%     | Spreads the incoming sound before the tank. Grey on **FDN 8**, **FDN 16**, and **Reverse**.                                  |

## Motion

| Control   | Range         | Default | What it does                                                                                                                       |
| --------- | ------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Rate**  | 0.1 to 5.0 Hz | 1.0 Hz  | Modulation speed. Grey on **FDN 8**, **FDN 16**, **Spring**, and **Reverse**.                                                      |
| **Depth** | 0 to 100%     | 30%     | Modulation amount. Grey on **Reverse**. **Freeze** on **Plate** also holds depth at 0 while it is on.                              |
| **Width** | 0 to 100%     | 50%     | Stereo width. The knob travels 0 to 2; the readout is that value as a percentage of 2. Grey on **Reverse** (the build-up is mono). |
| **E/L**   | 0 to 100%     | 40%     | Early reflections against the tank. 0% is all early, 100% is all tank. Grey on **Spring** and **Reverse**.                         |

## Character

| Control     | Range                  | Default    | What it does                                                                                               |
| ----------- | ---------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| **Gravity** | −1.00 to +1.00         | +0.50      | Tilts the plate tank. Negative is a reverse swell; positive is the ordinary direction. Grey off **Plate**. |
| **Vintage** | **Modern · 80s · 70s** | **Modern** | Same as the Flavor chips. The knob snaps to those three.                                                   |
| **Density** | 0 to 100%              | 100%       | How tightly the plate tank is coupled. Grey off **Plate**.                                                 |

## Decay EQ and Flow

**Decay EQ** draws six nodes on the spectrogram at 100 Hz, 400 Hz, 1.2 kHz, 3.5 kHz, 8 kHz, and
12 kHz. Each node is a multiplier on that band's decay, from 0.25× at the bottom to 4.0× at the
top. Centre (1.0×) is the base decay — the default for every band, and the setting that leaves that
band alone.

The overlay is a view. Closing it does not flatten the curve.

Decay EQ is relative to what the tail already loses on each pass. It does nothing while **Freeze**
is on (there is no decay to multiply). On **Plate** it also does nothing at **Decay** 0.999 or
above — turn Decay down to use it. On **Reverse** the chip still opens the overlay, and the nodes
draw and refuse to move.

**Flow** is only a picture of the path.

## Switches

The same **Shimmer**, **Freeze**, and **Saturation** chips sit in Flavor. Amount, Pitch, and the
curve chips appear here when the matching switch is on.

| Control                 | Range                  | Default    | What it does                                                                                                  |
| ----------------------- | ---------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| **Freeze**              | On / Off               | Off        | Holds the tank at full sustain and closes the input. Grey off **Plate**.                                      |
| **Shimmer**             | On / Off               | Off        | A pitch shifter in the loop. Grey off **Plate**.                                                              |
| **Amount**              | 0 to 100%              | 20%        | How much shimmer. Shown while **Shimmer** is on.                                                              |
| **Pitch**               | **Fifth** / **Octave** | **Octave** | Interval. Shown while **Shimmer** is on.                                                                      |
| **Saturation**          | On / Off               | Off        | Saturator on the output. Grey on **Spring** and **Reverse**. Live on **Plate** and on **FDN 8** / **FDN 16**. |
| **Tanh · Cheby · Clip** | those three            | **Tanh**   | Curve. Shown while **Saturation** is on. Live on **Plate** only.                                              |

On **Plate**, turning **Freeze** on also silences shimmer in the tank. The **Shimmer** chip can
stay lit. Turning **Freeze** off does not bring shimmer back until you click **Shimmer** off and
on again.

## Meters and readouts

| Readout                                                | Shows                                                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| **Decay** (header)                                     | The Decay knob's readout — coefficient, or seconds on **FDN 8** / **FDN 16** |
| **Mix** (header)                                       | Wet mix                                                                      |
| **Pre** (header)                                       | Pre-delay                                                                    |
| **Width** (header)                                     | Stereo width as a percentage                                                 |
| Spectrogram                                            | A picture of the tail, with the Decay EQ overlay when that chip is on        |
| **High cut** / **Low cut** / **Damping** / **Gravity** | The same values as **Hi Cut**, **Lo Cut**, **Damp**, and **Gravity**         |
| **Freeze on / off** · **Shimmer on / off**             | Whether those switches are on                                                |

## Presets

Loading a factory preset replaces the whole patch, including algorithm, mix, and decay.

## Automation and control

These panel controls have automation lanes. The lane uses the longer name where the two differ:

| On the panel   | In automation lanes               |
| -------------- | --------------------------------- |
| **Mix**        | Mix                               |
| **Decay**      | Decay                             |
| **Damp**       | Damping                           |
| **Pre**        | Pre-Delay                         |
| **Size**       | Size                              |
| **Rate**       | Mod Rate                          |
| **Depth**      | Mod Depth                         |
| **Diffuse**    | Diffusion                         |
| **Hi Cut**     | High Cut                          |
| **Lo Cut**     | Low Cut                           |
| **Width**      | Width                             |
| **Freeze**     | Freeze                            |
| **Shimmer**    | Shimmer                           |
| **Amount**     | Shimmer Amount                    |
| **Gravity**    | Gravity                           |
| **E/L**        | Early/Late                        |
| **Density**    | Density                           |
| Decay EQ nodes | Decay EQ LF, LM, Mid, UM, HF, Air |

**Pitch**, **Saturation**, the saturation curve, **Algorithm**, **Vintage**, **Decay EQ** (the view
chip), **Flow**, **Space tray**, and the IR tray do not appear as lanes.

## See also

- [Concepts](../02-concepts.md) — device chains, parameters, and automation
- [Manual index](../README.md) — every chapter and device page
