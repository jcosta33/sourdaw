# Proof — Mastering

Proof is a mastering chain: equaliser, four-band dynamics, stereo imager, harmonic exciter, and
limiter, plus delivery targets and loudness meters. Reach for it on a mix bus or a master when the
job is a finish, not a single effect.

The panel is labelled **Mastering desk**. It opens on **Play**.

**Type** Audio effect · **Category** Mastering · **Load from** Sidebar → Effects → Proof

<!-- ac: SPEC-effects-mastering-ui/AC-008 -->

## At a glance

- Five modules in series: **EQ**, **Dynamics**, **Imager**, **Exciter**, **Limiter**.
- Delivery **Target** chips that set a LUFS goal for the warning, not a loudness processor.
- **Play · Shape · Build · Route · Lab** change how much of the desk you see.
- Input and output gain, a ceiling, dither, and loudness meters.

## First moves

1. Add Proof to a bus or the master and play the mix through it.
2. Leave **Target** on **Streaming (−14 LUFS)** unless you are delivering somewhere else.
3. Watch **Output** and **Ceiling**. The limiter is already on, at −1.0 dBTP.
4. Open **Build** when you want the equaliser and the other modules, not only the target desk.
5. Click **B / wet** in **Check** to hear the chain off. It reads **A / dry** while the chain is
   bypassed.

## Play, Shape, Build, Route, Lab

The five chips in the rail change how much of the panel you see. They do not bypass the chain. The
device opens on **Play**. The choice is this session only — it is not stored in the project.

| Chip      | Heading           | What you get                                                                                             |
| --------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| **Play**  | **Target desk**   | Target list, Input / Output LUFS, **Ceiling**.                                                           |
| **Shape** | **Chain shape**   | The five modules as a strip you can switch off, with **IN** meters between them, plus four knobs.        |
| **Build** | **Module detail** | Full **EQ**, **Multiband Dynamics**, **Stereo Imager**, **Harmonic Exciter**, and **Limiter**.           |
| **Route** | **Chain route**   | **Signal Chain Order**, **Input Gain**, **Output Gain**.                                                 |
| **Lab**   | **Check bench**   | **Loudness History**, **Tonal Balance**, the full meter grid, and **Reset Integrated LUFS + True Peak**. |

## Target

**Target** is a delivery goal for the warning, not a loudness processor. It does not write
**Ceiling**. Picking a row writes that row's LUFS into the goal the alert uses.

There is no **custom** chip. A saved project can still carry a custom goal; then no row in this list
is highlighted.

| Row           |     Goal |
| ------------- | -------: |
| **Streaming** | −14 LUFS |
| **CD**        |  −9 LUFS |
| **Club / DJ** |  −6 LUFS |
| **Broadcast** | −23 LUFS |
| **Podcast**   | −16 LUFS |

A warning appears when integrated loudness is more than 1 LU above that goal.

**Streaming**, **Podcast**, and **Broadcast** name the platform and how far it would turn the master
down. **CD** and **Club / DJ** say that goal is one no platform normalizes. If the master is also
louder than −14 LUFS, that same warning adds that streaming platforms would still turn it down.

Loading a factory preset can also write **Ceiling**. Clicking a **Target** row does not.

## Ceiling and compare

| Control                   | Range             | Default     | What it does                                                                                  |
| ------------------------- | ----------------- | ----------- | --------------------------------------------------------------------------------------------- |
| **Ceiling**               | −12.0 to 0.0 dBTP | −1.0 dBTP   | Limiter stop. On **Play**, **Shape**, **Check**, and **Limiter**.                             |
| **B / wet** · **A / dry** | those two         | **B / wet** | Bypasses the whole chain at the input. Runtime only — it is not saved in the project.         |
| **Reset loudness**        | —                 | —           | Clears the integrated loudness meters. Also **Reset Integrated LUFS + True Peak** on **Lab**. |

## Shape

Each module name on the strip is an on/off. **Exciter** starts **OFF**; the other four start **ON**.

The four knobs are not the full modules. **Threshold**, **Width**, and **Drive** are macros.
**Ceiling** is the same limiter stop as on **Play**, **Check**, and **Limiter**.

| Control                    | Range             | Default   | What it does                                                                                       |
| -------------------------- | ----------------- | --------- | -------------------------------------------------------------------------------------------------- |
| **Dynamics** **Threshold** | −60 to 0 dB       | −20 dB    | Moves all four dynamics thresholds together, keeping the offsets between bands.                    |
| **Imager** **Width**       | 0 to 2            | 1.0       | Moves **Hi-Mid** and **High** width together. **Sub** and **Low-Mid** stay put.                    |
| **Exciter** **Drive**      | 0 to 1            | 0.2       | Moves all four drives together. If every band is off, turning Drive up also switches the bands on. |
| **Limiter** **Ceiling**    | −12.0 to 0.0 dBTP | −1.0 dBTP | The same **Ceiling** as everywhere else on the desk.                                               |

## EQ

Eight bands. A coloured dot enables the band. **ON / OFF** on the header bypasses the whole
equaliser.

On **HP** and **LP**, **Gain** is stored and does not change the sound — those types have no boost
or cut, only **Frequency** and **Q**.

| Band           | Type         | Frequency | Gain   | Q   | Enabled |
| -------------- | ------------ | --------- | ------ | --- | ------- |
| **Low Cut**    | **HP**       | 30 Hz     | 0.0 dB | 0.7 | off     |
| **Low Shelf**  | **Lo Shelf** | 80 Hz     | 0.0 dB | 0.7 | on      |
| **Low-Mid**    | **Peak**     | 250 Hz    | 0.0 dB | 1.0 | on      |
| **Mid**        | **Peak**     | 800 Hz    | 0.0 dB | 1.0 | on      |
| **High-Mid**   | **Peak**     | 2.5k      | 0.0 dB | 1.0 | on      |
| **High**       | **Peak**     | 6.0k      | 0.0 dB | 1.0 | on      |
| **High Shelf** | **Hi Shelf** | 12.0k     | 0.0 dB | 0.7 | on      |
| **High Cut**   | **LP**       | 18.0k     | 0.0 dB | 0.7 | off     |

| Control   | Range                                    | Default  | What it does                                                                 |
| --------- | ---------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| Frequency | 20 Hz to 20.0k                           | per band | Centre or cutoff. The readout drops units and prints `k` at 1 kHz and above. |
| Gain      | −18.0 to +18.0 dB                        | 0.0 dB   | Boost or cut. Unused on **HP** and **LP**.                                   |
| Q         | 0.1 to 10.0                              | per band | Width. Printed as **Q** plus one decimal.                                    |
| Type      | **Peak · Lo Shelf · Hi Shelf · HP · LP** | per band | Filter shape.                                                                |
| Channel   | **L/R · Mid · Side**                     | **L/R**  | Stereo, mid only, or side only.                                              |

You can also drag the nodes on the EQ graph.

## Multiband Dynamics

Four bands: **Sub**, **Low-Mid**, **Hi-Mid**, **High**. Header **ON / OFF** bypasses the module.

**Crossovers:** three splits, default 120 Hz, 1.0k, 8.0k. Each knob's travel stops at its
neighbours so the splits cannot cross. The stored range is 20 Hz to 20.0k.

| Band        | Threshold | Ratio | Attack | Release |
| ----------- | --------: | ----: | -----: | ------: |
| **Sub**     |    −20 dB |     2 |  10 ms |  100 ms |
| **Low-Mid** |    −18 dB |     2 |  10 ms |  100 ms |
| **Hi-Mid**  |    −16 dB |   1.5 |   5 ms |   80 ms |
| **High**    |    −14 dB |   1.5 |   3 ms |   60 ms |

| Control   | Range         | What it does                   |
| --------- | ------------- | ------------------------------ |
| **Thr**   | −60 to 0 dB   | Level where reduction begins.  |
| **Ratio** | 1 to 20       | How hard the band compresses.  |
| **Atk**   | 1 to 200 ms   | How quickly reduction engages. |
| **Rel**   | 10 to 2000 ms | How quickly reduction lets go. |

Each band shows its gain reduction in dB.

## Stereo Imager

Header **ON / OFF**. Width 0 reads **Mono**; any other value is a percentage of the 0–2 knob
(1.00 → 100%).

| Band        | Default width |
| ----------- | ------------- |
| **Sub**     | **Mono**      |
| **Low-Mid** | 80%           |
| **Hi-Mid**  | 100%          |
| **High**    | 130%          |

| Control                        | Range        | Default  | What it does                                       |
| ------------------------------ | ------------ | -------- | -------------------------------------------------- |
| Width knobs                    | 0 to 2       | per band | Stereo width of that band.                         |
| **Auto Mono Bass**             | On / Off     | On       | Forces the lowest split to follow the Hz knob.     |
| Hz (beside **Auto Mono Bass**) | 40 to 200 Hz | 80 Hz    | That lowest split, while **Auto Mono Bass** is on. |

**Correlation** is a meter, not a control.

## Harmonic Exciter

Header **ON / OFF**. The module starts **OFF**, and every band starts disabled.

| Band        | Type     | Drive | Blend | Enabled |
| ----------- | -------- | ----- | ----- | ------- |
| **Sub**     | **Tape** | 0.2   | 0.3   | off     |
| **Low-Mid** | **Tape** | 0.2   | 0.3   | off     |
| **Hi-Mid**  | **Tape** | 0.2   | 0.3   | off     |
| **High**    | **Tape** | 0.3   | 0.4   | off     |

| Control     | Range                               | What it does                           |
| ----------- | ----------------------------------- | -------------------------------------- |
| Band switch | On / Off                            | Enables that band's saturator.         |
| Type        | **Tape · Tube · Transistor · Warm** | Curve.                                 |
| **Drive**   | 0 to 1                              | How hard the saturator is hit.         |
| **Blend**   | 0 to 1                              | Mix of excited and clean in that band. |

Turn the header **ON** and enable a band, or the Shape **Drive** macro will not be audible.

## Limiter

Header **ON / OFF**. On by default.

| Control       | Range                         | Default   | What it does                                                          |
| ------------- | ----------------------------- | --------- | --------------------------------------------------------------------- |
| **Ceiling**   | −12.0 to 0.0 dBTP             | −1.0 dBTP | Output stop.                                                          |
| **Release**   | 10 to 500 ms                  | 100 ms    | How quickly reduction lets go.                                        |
| **Lookahead** | 0.5 to 10.0 ms                | 5.0 ms    | Extra delay so reduction can start before the peak.                   |
| **Dither**    | **Off · TPDF · Noise Shaped** | **Off**   | Dither after the limiter.                                             |
| **Bits**      | **16 · 24**                   | **16**    | Word length for dither. Only matters while **Dither** is not **Off**. |

**GR** is current gain reduction. **True Peak** turns red above −1.0 dBTP, even if **Ceiling** is
set higher than that.

## Route

**Signal Chain Order** lists **EQ**, **Dynamics**, **Imager**, **Exciter**, **Limiter**. The default
order is that list, first to last. The arrows move a module earlier or later. The sound follows the
order.

| Control         | Range             | Default | What it does            |
| --------------- | ----------------- | ------- | ----------------------- |
| **Input Gain**  | −24.0 to +24.0 dB | 0.0 dB  | Push into the chain.    |
| **Output Gain** | −24.0 to +24.0 dB | 0.0 dB  | Makeup after the chain. |

## Meters and readouts

| Readout                       | Shows                                                                      |
| ----------------------------- | -------------------------------------------------------------------------- |
| **In** / **Out** (header)     | Input and output LUFS                                                      |
| **Peak**                      | True peak                                                                  |
| **LRA**                       | Loudness range, in LU                                                      |
| **Integrated**                | Integrated LUFS                                                            |
| **Correlation**               | Stereo correlation                                                         |
| **Limiter GR**                | Limiter gain reduction                                                     |
| **Input** / **Output** (Play) | The same LUFS pair, larger                                                 |
| **Short-term**                | Short-term LUFS                                                            |
| **Loudness History**          | Integrated loudness over time, against the Target                          |
| **Tonal Balance**             | Spectrum against a target curve                                            |
| **Gain Applied**              | Input versus output on **Lab**                                             |
| **Momentary LUFS**            | Momentary loudness                                                         |
| **Reported latency**          | Delay the chain is adding, in samples (and ms when above 0). On **Route**. |

**Tonal Balance** follows the master output, not this insert. On a track that is not the master,
the picture is the rest of the mix. When the analyser is missing, the overlay reads **Spectrum
analyser unavailable — showing the target curve only**.

## Presets

Loading a factory preset replaces the whole patch, including Target, Ceiling, and every module.

## Automation and control

These panel controls have automation lanes:

| On the panel | In automation lanes |
| ------------ | ------------------- |
| Input Gain   | Input Gain          |
| Output Gain  | Output Gain         |
| **Ceiling**  | Ceiling             |

Play / Shape / Build / Route / Lab, Target, A/B, module on/off, EQ bands, dynamics, imager,
exciter, limiter Release and Lookahead, dither, chain order, and Reset loudness do not appear as
lanes.

Target, module on/off, EQ bands, dynamics, imager, exciter, limiter Release and Lookahead, dither,
and chain order still save with the project. Play / Shape / Build / Route / Lab is this session
only. **Reset loudness** is an action and stores nothing. A/B is runtime only.

## See also

- [Crust](./08-crust.md) — limiter on its own, when you do not want the rest of the chain
- [Gluten](./07-gluten.md) — compressor
- [Concepts](../02-concepts.md) — device chains, parameters, and automation
- [Manual index](../README.md) — every chapter and device page
