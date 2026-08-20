# Bacteria — Creative multi-FX

Bacteria is a multi-band mangler: distortion, filter, chorus, phaser, granular, spectral blur,
frequency shift, lo-fi, and a body stage, split across up to six bands. Add it when a track needs
texture, not a single dedicated compressor or reverb.

The left rail heading is **Cultures**. The panel opens on **Play**. The header title is **Bacteria**.

**Type** Audio effect · **Category** Creative FX · **Load from** Sidebar → Effects → Bacteria

The Effects card reads **Multi-band mangler · Distortion · Granular · Spectral**.

## At a glance

- Five views: **Play**, **Shape**, **Build**, **Route**, **Lab**.
- Factory cultures in the left rail, plus Input, Output, and Mix.
- Per-band modules on **Shape**, all off on a new device.
- Up to six bands, serial / parallel / mid-side routing.

## First moves

1. Add Bacteria to a track and play material through it.
2. Load a culture from **Preset drawer**, or stay on **Init** and open **Shape**.
3. Click **Drive**, click **Enabled**, and turn **Drive**.
4. Open **Build** only when you want more than one band.

A new device is one band, serial, Mix at 1, Input and Output at 0 dB. Every module starts off, so
**Init** is a bypassed chain until you enable something or load a culture.

## Play, Shape, Build, Route, Lab

The five chips in the header change how much of the panel you see. They do not bypass the device.
The choice is this session only — it is not stored in the project.

| Chip      | Heading           | What you get                                                                                          |
| --------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| **Play**  | **Morph floor**   | **Morph field**, **Current broth**, **Gain staging**, **Performance cluster**, **Crosshair offsets**. |
| **Shape** | **Mutation deck** | One module at a time on the active band, plus **Fast movers**.                                        |
| **Build** | **Band broth**    | **Crossover tray**, band cards, **Crossover controls**, **Source dock**.                              |
| **Route** | **Dish map**      | **Signal petri**, **Routing mode**, **Lane overrides**.                                               |
| **Lab**   | **Bench**         | Curve editors, **Motion core**, **Bench controls**.                                                   |

From **Shape** onward, **Band 1** … chips pick the band the module knobs edit. That selection is
this session only.

The header LED shows the active module name (**Drive** on a new device). **Live** / **Bypassed**
sits on the right. **Bypassed** silences the effect and remembers with the project.

## Cultures

Search placeholder **Search cultures**. Category chips start on **All**. The other chips are
**Saturation**, **Destruction**, **Filter**, **Granular**, **Lo-Fi**, **Creative**, **Spectral**,
and **Performance**.

**Preset drawer** lists matching cultures. Clicking a row replaces the whole patch. The drawer
caption is the current patch name (**Init** until you load one).

Do not hunt the factory list for a complete catalogue — it will grow. Use search and the category
chips.

| Tile          | Shows                                        |
| ------------- | -------------------------------------------- |
| **Bands**     | How many bands are live                      |
| **Routing**   | `serial`, `parallel`, or `mid/side`          |
| **Active FX** | How many modules are on in the selected band |
| **Mix**       | Global Mix as a percentage (100% at Mix 1)   |

## Play

### Morph field

Heading **Morph field**, badge **A/B/C/D**. Drag the pad crosshair. Corners are labelled **A**,
**B**, **C**, and **D**. Under the pad, **Snap A** … **Snap D** show those names.

| Control | Range  | Default | What it does                         |
| ------- | ------ | ------- | ------------------------------------ |
| Pad     | 0–1    | centre  | Writes **X** and **Y**.              |
| **X**   | 0 to 1 | 0.5     | Same value as the pad, left to right |
| **Y**   | 0 to 1 | 0.5     | Same value as the pad, bottom to top |

> [!WARNING]
> **Not yet active.** The pad and **X** / **Y** remember their place, but they do not morph the
> patch. **Snap A**–**D** are labels, not capture buttons, and a new device stores empty corners.
> [#2388](https://github.com/jcosta33/sourdaw/issues/2388)

### Current broth

Heading **Current broth**. Spectrum and crossover map for the live band count. Click a band on the
map to select it. Drag a split to move that corner. The badge is the global routing word, with the
hyphen dropped (`serial`, `parallel`, `mid side`).

### Gain staging

Heading **Gain staging**.

| Control    | Range         | Default | What it does            |
| ---------- | ------------- | ------- | ----------------------- |
| **Input**  | −24 to +24 dB | 0 dB    | Gain into the device    |
| **Output** | −24 to +24 dB | 0 dB    | Gain after Mix          |
| **Mix**    | 0 to 1        | 1       | Dry/wet. 1 is fully wet |

**Band energy** under that card is per-band level, **B1** … with a dB readout.

### Performance cluster

Heading **Performance cluster**, badge **8 slots**.

| Control           | Range  | Default | What it does      |
| ----------------- | ------ | ------- | ----------------- |
| **Macro 1**–**8** | 0 to 1 | 0.5     | Performance knobs |

> [!WARNING]
> **Not yet active.** **Macro 1**–**8** remember their values and do not move a module. There is no
> working assignment from a macro onto Drive, Filter, or anything else.
> [#2389](https://github.com/jcosta33/sourdaw/issues/2389)

## Shape

Heading is the selected module. Chips: **Drive**, **Filter**, **Chorus**, **Phaser**, **Granular**,
**Spectral**, **Shift**, **Lo-Fi**, **Body**. Each page has **Enabled**. All nine start off.

**Fast movers** stay under every module.

### Drive

Modes print with the hyphen dropped: **soft clip**, **hard clip**, **foldback**, **wavefold**,
**bitcrush**, **tube**, **breakdown**, **smudge**, **custom**. Default mode **soft clip**.

| Control      | Range     | Default | What it does                                      |
| ------------ | --------- | ------- | ------------------------------------------------- |
| **Enabled**  | on / off  | off     | Runs distortion on this band                      |
| **Drive**    | 0 to 100% | 25%     | How hard the shaper is pushed                     |
| **Asym**     | −1 to 1   | 0       | Positive vs negative half                         |
| **Fold**     | 0.1 to 1  | 0.7     | Foldback threshold. Visible on **foldback** only  |
| **Bits**     | 1 to 24   | 16      | Bit depth. Visible on **bitcrush** only           |
| **Rate div** | 1 to 64   | 1       | Sample-rate divider. Visible on **bitcrush** only |
| **Bias**     | 0 to 1    | 0.5     | Tube bias. Visible on **tube** only               |
| **Depth**    | 0 to 4 st | 1 st    | Breakdown depth. Visible on **breakdown** only    |

> [!WARNING]
> **Not yet active.** **breakdown** is on the chip row and remembers **Depth**, but it still sounds
> like **soft clip**.
> [#2392](https://github.com/jcosta33/sourdaw/issues/2392)

> [!WARNING]
> **Not yet active.** **custom** is on the chip row and still sounds like **soft clip**. Drawing on
> Lab **Shaper bench** does not change it.
> [#2390](https://github.com/jcosta33/sourdaw/issues/2390)

### Filter

Modes print as **lowpass**, **highpass**, **bandpass**, **notch**, **formant**, **comb**. Default
**lowpass**.

| Control     | Range           | Default | What it does                 |
| ----------- | --------------- | ------- | ---------------------------- |
| **Enabled** | on / off        | off     | Runs the filter on this band |
| **Cutoff**  | 20 to 20 000 Hz | 8000 Hz | Corner or centre, by mode    |
| **Reso**    | 0 to 1          | 0.3     | Resonance                    |
| **Env**     | −1 to 1         | 0       | Envelope amount onto cutoff  |
| **Atk**     | 0.1 to 500 ms   | 5 ms    | Filter envelope attack       |
| **Rel**     | 1 to 5000 ms    | 200 ms  | Filter envelope release      |

### Chorus

| Control     | Range         | Default | What it does             |
| ----------- | ------------- | ------- | ------------------------ |
| **Enabled** | on / off      | off     | Runs chorus on this band |
| **Rate**    | 0.01 to 20 Hz | 1.5 Hz  | LFO rate                 |
| **Depth**   | 0 to 1        | 0.4     | Modulation depth         |
| **Feed**    | −1 to 1       | 0.2     | Feedback                 |
| **Mix**     | 0 to 1        | 0.5     | Module dry/wet           |

### Phaser

| Control     | Range         | Default | What it does             |
| ----------- | ------------- | ------- | ------------------------ |
| **Enabled** | on / off      | off     | Runs phaser on this band |
| **Rate**    | 0.01 to 10 Hz | 0.5 Hz  | Sweep rate               |
| **Depth**   | 0 to 1        | 0.7     | Sweep depth              |
| **Feed**    | −1 to 1       | 0.5     | Feedback                 |
| **Mix**     | 0 to 1        | 0.5     | Module dry/wet           |

### Granular

| Control     | Range         | Default | What it does               |
| ----------- | ------------- | ------- | -------------------------- |
| **Enabled** | on / off      | off     | Runs granular on this band |
| **Freeze**  | on / off      | off     | Holds the grain buffer     |
| **Size**    | 10 to 500 ms  | 80 ms   | Grain length               |
| **Density** | 1 to 100      | 15      | Grains per second          |
| **Offset**  | 0 to 2000 ms  | 100 ms  | Position in the buffer     |
| **Pitch**   | −24 to +24 st | 0 st    | Grain transpose            |
| **Mix**     | 0 to 1        | 0.5     | Module dry/wet             |

### Spectral

| Control     | Range    | Default | What it does             |
| ----------- | -------- | ------- | ------------------------ |
| **Enabled** | on / off | off     | Runs spectral processing |
| **Freeze**  | on / off | off     | Holds the spectrum       |
| **Blur**    | 0 to 1   | 0.5     | Spectral smear           |
| **Mix**     | 0 to 1   | 0.5     | Module dry/wet           |

### Shift

| Control     | Range             | Default | What it does         |
| ----------- | ----------------- | ------- | -------------------- |
| **Enabled** | on / off          | off     | Runs frequency shift |
| **Shift**   | −1000 to +1000 Hz | 0 Hz    | Offset in hertz      |
| **Mix**     | 0 to 1            | 0.5     | Module dry/wet       |

### Lo-Fi

| Control     | Range     | Default | What it does            |
| ----------- | --------- | ------- | ----------------------- |
| **Enabled** | on / off  | off     | Runs lo-fi on this band |
| **Amount**  | 0 to 100% | 0%      | Degradation amount      |
| **Codec**   | 0 to 1    | 0       | Codec artefact          |

### Body

| Control     | Range    | Default | What it does        |
| ----------- | -------- | ------- | ------------------- |
| **Enabled** | on / off | off     | Intended body stage |
| **Mix**     | 0 to 1   | 0.3     | Body mix            |
| **Spread**  | 0 to 1   | 0.5     | Stereo spread       |

> [!WARNING]
> **Not yet active.** **Body** has **Enabled**, **Mix**, and **Spread**, and no way to load a body
> impulse. Enabling it does not change the sound.
> [#2391](https://github.com/jcosta33/sourdaw/issues/2391)

### Fast movers

Heading **Fast movers**. These are global, not per-band.

| Control     | Range         | Default | What it does          |
| ----------- | ------------- | ------- | --------------------- |
| **LFO 1**   | 0.01 to 40 Hz | 2 Hz    | LFO 1 rate            |
| **LFO Amt** | 0 to 1        | 0.5     | LFO 1 amount          |
| **Env Atk** | 0.1 to 100 ms | 5 ms    | Envelope-follower atk |
| **Env Rel** | 1 to 2000 ms  | 200 ms  | Envelope-follower rel |

> [!WARNING]
> **Not yet active.** **LFO 1**, **LFO Amt**, **Env Atk**, and **Env Rel** remember their values
> and do not move a module until an assignment exists.
> [#2389](https://github.com/jcosta33/sourdaw/issues/2389)

## Build

### Crossover tray

Heading **Crossover tray**, badge **N bands**. Same analyser and split map as **Current broth**.
**Band cards** sit under it: **Band 1** …, **S** / **M**, module dots (**DST**, **FLT**, **CHR**,
**GRN**, **SPC**, **FSH**, **PHS**, **LFI**, **BDY**), and a gain knob.

| Control   | Range         | Default | What it does                         |
| --------- | ------------- | ------- | ------------------------------------ |
| **S**     | on / off      | off     | Solo this band                       |
| **M**     | on / off      | off     | Mute this band                       |
| Band gain | −24 to +24 dB | 0 dB    | Level of that band after its modules |

The LED on the card row prints the crossover mode (`lr4` or `linear-phase`).

### Crossover controls

Heading **Crossover controls**.

| Control                                 | Range      | Default   | What it does            |
| --------------------------------------- | ---------- | --------- | ----------------------- |
| **1 band** … **6 bands**                | 1 to 6     | 1 band    | How many lanes are live |
| **12 dB** **24 dB** **36 dB** **48 dB** | those four | **24 dB** | Crossover slope         |
| **LR4** / **Linear**                    | those two  | **LR4**   | Crossover flavour       |

Corners used as the count grows: 200 Hz, 800 Hz, 2500 Hz, 6000 Hz, 12 000 Hz. Each is 20 Hz to
20 000 Hz.

### Source dock

Heading **Source dock**. Pills: **LFO 1**, **LFO 2**, **Env Follow**, **Lorenz**, **Step Seq**,
**Macro 1**–**4**.

> [!WARNING]
> **Not yet active.** The dock lists sources and cannot assign one to a knob. There is nothing to
> remove on a new device, and remove does not write.
> [#2389](https://github.com/jcosta33/sourdaw/issues/2389)

## Route

### Signal petri

Heading **Signal petri**. A map of the live bands and global routing. It follows **Routing mode**;
it is not a graph you rewire by dragging.

### Routing mode

Heading **Routing mode**.

| Control                              | Range       | Default    | What it does               |
| ------------------------------------ | ----------- | ---------- | -------------------------- |
| **Serial** **Parallel** **Mid/side** | those three | **Serial** | How the live bands combine |

### Lane overrides

Heading **Lane overrides**. One row per live band: **Band 1** … with **serial**, **parallel**, and
**M/S**. Default per band is **serial**.

## Lab

### Shaper bench, Bezier drift, Sequencer, Spectral gate

Headings **Shaper bench**, **Bezier drift**, **Sequencer** (badge **N steps**), **Spectral gate**.

> [!WARNING]
> **Not yet active.** The four Lab editors draw, but the strokes do not save and do not reach the
> sound. **Sequencer**'s badge follows **Steps**; the grid itself does not.
> [#2390](https://github.com/jcosta33/sourdaw/issues/2390)

### Motion core

Heading **Motion core**.

| Control                                     | Range         | Default | What it does  |
| ------------------------------------------- | ------------- | ------- | ------------- |
| **LFO 1**                                   | 0.01 to 40 Hz | 2 Hz    | Same as Shape |
| **Amt 1**                                   | 0 to 1        | 0.5     | LFO 1 amount  |
| **LFO 2**                                   | 0.01 to 40 Hz | 0.5 Hz  | LFO 2 rate    |
| **Amt 2**                                   | 0 to 1        | 0.5     | LFO 2 amount  |
| **LFO1 Sin** **Tri** **Saw** **Sq** **S&H** | those five    | **Sin** | LFO 1 shape   |
| **LFO2 Sin** **Tri** **Saw** **Sq** **S&H** | those five    | **Tri** | LFO 2 shape   |

### Bench controls

Heading **Bench controls**.

| Control     | Range         | Default | What it does          |
| ----------- | ------------- | ------- | --------------------- |
| **Env Atk** | 0.1 to 100 ms | 5 ms    | Same envelope attack  |
| **Env Rel** | 1 to 2000 ms  | 200 ms  | Same envelope release |
| **Steps**   | 1 to 32       | 16      | Step-seq length       |
| **Step Hz** | 0.5 to 32 Hz  | 4 Hz    | Step-seq rate         |
| **Sigma**   | 1 to 30       | 10      | Lorenz sigma          |
| **Rho**     | 1 to 50       | 28      | Lorenz rho            |
| **Beta**    | 0.1 to 10     | 2.667   | Lorenz beta           |
| **Speed**   | 0.01 to 10    | 1       | Lorenz speed          |

> [!WARNING]
> **Not yet active.** **Motion core** and **Bench controls** remember their values and do not move
> a module.
> [#2389](https://github.com/jcosta33/sourdaw/issues/2389)

## Meters and readouts

Footer tiles:

| Tile            | Shows                            |
| --------------- | -------------------------------- |
| **Input**       | Input level, dB                  |
| **Output**      | Output level, dB                 |
| **Latency**     | Device latency, `N smp`          |
| **Active band** | `B1` … for the selected band     |
| **Band energy** | Per-band meters, same as on Play |

The header also prints **In** / **Out** and **N active effects in band N**.

## Presets

Factory cultures live under **Cultures**. Loading one replaces the whole patch, including band
count, routing, and which modules are on.

**Play** / **Shape** / **Build** / **Route** / **Lab**, the module chip, the selected band, and the
culture search stay with this session.

## Automation and control

These names appear as automation lanes. They save with the project.

Mix, Input, Output, Bands, XOver 1–5, Slope, XOver Mode, Dist Mode, Drive, Asymmetry, Fold Thresh,
Bit Depth, SR Reduce, Breakdown, Filter Mode, Cutoff, Resonance, Env Amount, Chorus Rate, Chorus
Depth, Chorus FB, Chorus Mix, Phaser Rate, Phaser Depth, Phaser FB, Phaser Mix, Grain Size,
Density, Position, Grain Pitch, Grain Mix, Spec Blur, Spec Mix, Freq Shift, Shift Mix, Lo-Fi,
Codec, Body Mix, Separation, Macro 1–8, Morph X, Morph Y, LFO 1 Rate, LFO 1 Shape, LFO 1 Amt, LFO 2
Rate, LFO 2 Shape, LFO 2 Amt, Env Atk, Env Rel, Band Gain.

The list has one Drive, Cutoff, and so on — not one per band. Drawing a lane moves every live
band's copy of that control.

**Live** / **Bypassed** saves with the project and is not an automation lane.

Macro and morph lanes still do not change the sound. See [#2388](https://github.com/jcosta33/sourdaw/issues/2388)
and [#2389](https://github.com/jcosta33/sourdaw/issues/2389).

## See also

- [Concepts](../02-concepts.md) — device chains, parameters, and automation
- [Manual index](../README.md) — every chapter and device page
