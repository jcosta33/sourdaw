# Crust — Limiter

Crust is a limiter. Reach for it when a track or bus must not go above a ceiling, and when you want
that ceiling to hold on true peaks, not only on sample peaks. A saturation stage sits in front of
the limiter and is off until you turn it on.

The panel is labelled **Loudness desk**. It opens at **L2**. **L1** is a three-choice starting
point; **L3**–**L5** add saturation, routing, and extra statistics.

**Type** Audio effect · **Category** Limiter · **Load from** Sidebar → Effects → Crust

## At a glance

- Eight limiter algorithms, or three styles on **L1**.
- A **Target** menu that writes a ceiling for streaming, broadcast, and music delivery.
- Input **Gain** on a vertical strip; output **Ceiling** in dBTP.
- Optional saturation, multi-band limiting, mid-side, dither, and delta monitoring.
- Loudness meters (integrated, short-term, momentary, LRA) and a held true-peak reading.

## First moves

1. Add Crust to a track or bus and play material through it.
2. Pick a **Target**, or leave the default **Spotify / Apple Music** reading and set **Ceiling** by
   hand.
3. Raise **Gain** until **Shave** shows a few dB on the loudest hits. The ceiling is the stop, not
   the gain.
4. Turn on **True peak** if it is off — it is on by default — so inter-sample peaks cannot sneak
   past the ceiling.
5. Compare with **A=B** if you have pushed **Gain** and want to hear the limiting without the extra
   level.

## Levels

**L1** through **L5** in the header change how much of the panel you see. They do not bypass the
limiter. The device opens on **L2**.

| Chip | What you get |
|---|---|
| **L1** | Three style tiles: **TRANSPARENT**, **PUNCHY**, **LOUD**. |
| **L2** | Algorithm, Lookahead, Attack, Release, Link Trans, Link Rel. Oversampling chips appear in the footer. |
| **L3** | Saturation, plus **DELTA** and **A=B** in the control zone (the footer already has those two). |
| **L4** | Multi-band, Stereo, SC HPF, Dithering. |
| **L5** | Extra loudness statistics under the controls. |

**L1** writes the limiter to Transparent, Punchy, or Wall (**LOUD**). It does not move the
**Algorithm** chips on **L2**. After using **L1**, listen — the highlighted algorithm on **L2** can
disagree with what you hear.

## Target

**Target** is a delivery preset, not a loudness processor. Choosing a row other than **Custom…**
writes **Ceiling** to that row's true-peak value. **Custom…** does not touch **Ceiling**.

The device loads with **Target** on **Spotify / Apple Music** (−14 LUFS in the menu) and **Ceiling**
at −0.3 dBTP. Those two only match after you pick the row again, which writes **Ceiling** to
−1.0 dBTP.

| Group | Row | Loudness shown | Ceiling written |
|---|---|---:|---:|
| Streaming | **Spotify / Apple Music** | −14 LUFS | −1.0 dBTP |
| Streaming | **YouTube** | −14 LUFS | −1.0 dBTP |
| Streaming | **Tidal** | −14 LUFS | −1.0 dBTP |
| Streaming | **Amazon Music** | −14 LUFS | −2.0 dBTP |
| Broadcast | **EBU R128** | −23 LUFS | −1.0 dBTP |
| Broadcast | **ATSC A/85 (US TV)** | −24 LUFS | −2.0 dBTP |
| Music | **CD Master** | −9 LUFS | −0.1 dBTP |
| Music | **Club / Dance** | −8 LUFS | −0.3 dBTP |
| Music | **Hi-Fi Streaming** | −12 LUFS | −1.0 dBTP |
| Custom | **Custom…** | — | unchanged |

The header LED reads **On target** while short-term loudness stays within 0.25 dB of the target, and
**Watch _n_ dB** when short-term is louder than that. **Custom…** has no target, so Penalty and the
LED treat it as no goal.

## Gain and ceiling

| Control | Range | Default | What it does |
|---|---|---|---|
| **Gain** | 0 to +18 dB | 0 dB | Input push, on the left strip. Drag up to add gain. Hold Ctrl or Cmd for a finer drag. |
| **Ceiling** | −6 to 0 dBTP | −0.3 dBTP | Output stop. Also in the header as a readout, and as a number field in the footer. |
| **True peak** | On / Off | On | Limits inter-sample peaks, not only sample peaks. |
| **OS off · 2× · 4× · 8× · 16× · 32×** | those six | **4×** | Oversamples the limiter. **OS off** is 1×. Visible from **L2** up. |

**Push** (top tile) is the same value as **Gain**. **Shave** is how much the limiter is taking off
right now.

**A=B** removes that input gain at the output so you can hear the limiting without the extra level.
It is off by default.

## Algorithm (L2)

The line under the chips is the panel's own description of the selected algorithm.

| Control | Range | Default | What it does |
|---|---|---|---|
| **Transparent** | — | on | Clean ceiling, no color. |
| **Punchy** | — | off | Snap and edge, rhythm. |
| **Dynamic** | — | off | Enhances transients. |
| **Allround** | — | off | Balanced loudness. |
| **Aggressive** | — | off | Pushes hard. |
| **Bus** | — | off | Glue and pump. |
| **Safe** | — | off | Zero distortion. |
| **Wall** | — | off | Max ceiling. **L1** **LOUD** uses this. |

| Control | Range | Default | What it does |
|---|---|---|---|
| **Lookahead** | 0 to 10 ms | 2 ms | Delays the audio so reduction can start before the peak. At 0 ms there is no look-ahead. |
| **Attack** | 0 to 100 ms | Auto | How quickly reduction engages. **Attack Auto** is on by default; while it is on, the millisecond value is ignored. |
| **Release** | 0 to 1000 ms | Auto | How quickly reduction lets go. **Release Auto** is on by default. Release also stays automatic while the knob is at 0 ms, even if Auto is off. |
| **Link Trans** | 0 to 100% | 100% | How much the two channels share transient reduction. |
| **Link Rel** | 0 to 100% | 100% | How much the two channels share release. |

Turn Auto off, then move the knob, when you want a fixed time. On **Attack**, 0 ms with Auto off is
a real zero, not Auto.

## Saturation (L3)

Off by default. Drive and Mix do nothing until the section switch is on. The chips, curve, and knobs
go dim while it is off.

| Control | Range | Default | What it does |
|---|---|---|---|
| Section switch | On / Off | Off | Enables the saturator in front of the limiter. |
| **soft · hard · tape · tube · fold** | those five | **soft** | Saturation curve. |
| **Drive** | 0 to +18 dB | 0 dB | How hard the saturator is hit. **HOT** appears under the knob above +6 dB. |
| **Mix** | 0 to 100% | 0% | Blend of saturated and clean signal into the limiter. |

The limiter's ceiling still holds after saturation — fold at full mix cannot push the output back
over it.

## Multi-band, stereo, and dither (L4)

| Control | Range | Default | What it does |
|---|---|---|---|
| **Wide · 3band · 5band** | those three | **Wide** | Wideband, three-band, or five-band limiting. |
| **STEREO · MS** | those two | **STEREO** | Ordinary stereo, or mid-side. |
| **SC HPF** switch | On / Off | Off | High-pass on the detector so low end drives the limiter less. |
| **HPF** | 20 to 200 Hz | 60 Hz | Detector cutoff. Shown only while **SC HPF** is on. |
| **Dithering** | Off · TPDF 16-bit · TPDF 24-bit · POW-R 1 · POW-R 2 · POW-R 3 | Off | Dither before the true-peak safety stage. |
| **16-bit · 24-bit · 32-bit** | those three | **24-bit** | Output word length for dither. Shown only while dither is not Off. |

**3band** and **5band** split at 80 Hz and 2 kHz. There is no on-screen control for those
frequencies.

## Footer

| Control | Range | Default | What it does |
|---|---|---|---|
| **Delta** | On / Off | Off | Listen to what the limiter removed, not the programme. Also labelled **DELTA** on **L3**. |
| **A=B** | On / Off | Off | See Gain and ceiling. |
| **Reset** | — | — | Clears the panel meter readouts. Live meters fill in again as soon as audio is passing. |
| **TP max** reset | — | — | The small button on the **TP max** heading. Clears the held true-peak reading in the limiter. Use this, not **Reset**, when **Clip** has latched. |

## Meters and readouts

| Readout | Shows |
|---|---|
| **Push** | Input **Gain**, in dB |
| **Shave** | Current gain reduction, in dB |
| **Target** | The Target row's LUFS, or **Custom** |
| **Penalty** | How far short-term loudness exceeds the Target, in dB |
| Waveform | Input, output, reduction, and the Target line when there is one |
| **ST** / **TP** (on Mission control) | Short-term LUFS and held true peak |
| **Output** L / R / **GR** | Output level and gain reduction |
| Loudness | Integrated LUFS against the Target, plus **ST**, **MOM**, and **LRA** |
| **TP max** | Held true-peak maximum, with **Clear** or **Clip** |

**L5** repeats integrated, short-term max, momentary max, LRA, TP max, and GR max under the
controls.

## Presets

Eight factory presets in four categories — Mastering, Bus, Broadcast, and Creative. Loading one
replaces the whole patch, including algorithm, gain, ceiling, and saturation.

| Preset | Category |
|---|---|
| Transparent Master | Mastering |
| Punchy Bus | Bus |
| Allround Streaming | Mastering |
| Loud Club | Mastering |
| Broadcast EBU R128 | Broadcast |
| Safe Acoustic | Mastering |
| Warm Analog | Creative |
| Dynamic Rock | Bus |

## Automation and control

These panel controls have automation lanes. The lane uses the longer name where the two differ:

| On the panel | In automation lanes |
|---|---|
| **Gain** | Gain |
| **Ceiling** | Ceiling |
| **Lookahead** | Lookahead |
| **Attack** | Attack |
| **Attack Auto** | Attack Auto |
| **Release** | Release |
| **Release Auto** | Release Auto |
| **Link Trans** | Link Trans |
| **Link Rel** | Link Rel |
| **True peak** | True Peak |
| Oversampling chips | Oversampling |
| Saturation switch | Sat On |
| **Drive** | Sat Drive |
| **Mix** | Sat Mix |
| **Delta** | Delta |
| **HPF** | SC HPF |

**L1**–**L5**, **Target**, **Algorithm**, saturation type, **A=B**, **Wide / 3band / 5band**,
**STEREO / MS**, **SC HPF** on/off, **Dithering**, and bit depth do not appear as lanes.

## See also

- [Gluten](./07-gluten.md) — compressor, the other dynamics device
- [Concepts](../02-concepts.md) — device chains, parameters, and automation
- [Manual index](../README.md) — every chapter and device page
