# Gluten — Compressor

Gluten is a compressor with four selectable topologies, each with its own timing behaviour and
colour. Reach for it for bus glue, for level control on individual tracks, and for the deliberate
pumping and harmonic character that hardware-modelled compressors produce. When one stage is not
enough, a second topology can be blended in behind the first.

Picking the topology is most of the work. The rest of this page is what each one listens to.

**Type** Audio effect · **Category** Dynamics · **Load from** Sidebar → Effects → Gluten

## At a glance

- Four topologies — VCA, Opto, FET, Diode — with different timing and colour.
- Four Quick moves that reset topology and timing in one click.
- 16 presets across bus, vocal, drums, mastering, and creative categories.
- A draggable transfer curve, a gain-reduction meter, and rolling history.
- Parallel mix, lookahead, and delta monitoring built in.

## First moves

1. Add Gluten to a track or bus and play material through it.
2. Pick a topology. VCA for bus glue, Opto for vocals, FET for drums, Diode for weight.
3. Lower **Threshold** until **Grab** reads 3–6 dB on the loudest passages.
4. Set **Ratio** — 2:1 to 4:1 for glue, 8:1 and above for control.
5. Raise **Makeup** until bypassed and active levels match, or turn on **Auto Makeup**.

## Topology

Topology is the first choice, not a flavour applied afterwards. Each one responds to a different
subset of the controls, and the ones it ignores stay visible but do nothing.

| Topology | Character | Shaped by |
|---|---|---|
| **VCA** | Clean, disciplined, predictable | Threshold, Ratio, Knee, Attack, Release, Auto Release, Range, VCA Color, VCA Type, Feed-Forward |
| **Opto** | Slow, self-levelling, forgiving | Threshold, Limit Mode |
| **FET** | Fast, aggressive, harmonically rich | Threshold, Ratio, Attack, Release, Input Gain, Output Gain, Transformer, Odd, Even, All Buttons |
| **Diode** | Dense and weighty | Threshold, Ratio, Attack, Recovery, and the whole Detector section |

Opto ignores Ratio, Attack, Release, Knee, and Range entirely — its timing comes from the modelled
cell, and Threshold is the only shaping control you have. If you want to dial timing by hand, pick
another topology.

## Quick moves

The four Quick move buttons — Glue, Punch, Smooth, Pump — are one-click starting points, not
modifiers. Each one rewrites Topology, Threshold, Ratio, Attack, Release, and several other controls
at once. Use one as a departure point, then adjust.

## Clamp

| Control | Range | Default | What it does |
|---|---|---|---|
| **Threshold** | −60 to 0 dB | −18 dB | Level above which gain reduction begins. Draggable directly on the curve. |
| **Ratio** | 1:1 to 20:1 | 4:1 | How hard signal above the threshold is reduced. |
| **Knee** | 0 to 30 dB | 6 dB | Width of the soft transition around the threshold. VCA only. |
| **Attack** | 0.02 to 250 ms | 10 ms | How quickly reduction engages. Ignored by Opto. |
| **Release** | 25 to 5000 ms | 300 ms | How quickly reduction recovers. VCA and FET only. |
| **Amount** | 0 to 100% | 50% | Macro that sets Threshold and Ratio together. |

**Amount** sweeps Threshold and Ratio in one gesture. The Threshold and Ratio controls do not follow
it, and touching either one afterwards overrides what Amount set. Use one or the other, not both.

## Finish

| Control | Range | Default | What it does |
|---|---|---|---|
| **Makeup** | −12 to +24 dB | 0 dB | Gain applied to the compressed signal before the mix. |
| **Mix** | 0 to 100% | 100% | Blend of compressed and dry signal. |
| **Range** | 0 to 60 dB | 15 dB | Ceiling on total gain reduction. VCA only. |
| **Stereo Link** | 0 to 100% | 100% | Intended stereo detector linking. |
| **Lookahead** | 0 to 20 ms | 0 ms | Delays the audio so reduction starts before the transient. |
| **Blend** | 0 to 100% | 0% | Blends in the second topology. See Stage two, below. |
| **Stereo Mode** | Stereo · Mid · Side · Dual mono | Stereo | Which part of the stereo image is compressed. |
| **Auto Release** | On / Off | On | Adapts release to the material. VCA only. |
| **Auto Makeup** | On / Off | Off | Estimates makeup gain from Threshold and Ratio. |
| **Delta Listen** | On / Off | Off | Monitors only what compression removed. |
| **Gain Match** | On / Off | Off | Level-matches the bypassed signal to the processed one. |

**Mix** blends against the lookahead-delayed dry signal, so parallel settings stay phase-aligned at
any Lookahead value. **Gain Match** acts only while the device is bypassed — it is for honest A/B,
not for setting output level.

> [!WARNING]
> **Not yet active.** Stereo Link is stored with the preset but does not change detector linking.
> Stereo detection is fully linked in every topology.

## Detector

The Detector section shapes what the compressor listens to, without changing what you hear.

| Control | Range | Default | What it does |
|---|---|---|---|
| **SC HPF** | 20 Hz to 500 Hz | 80 Hz, on | Removes low end from the detector so bass stops driving reduction. |
| **SC LPF** | 1 kHz to 20 kHz | 20 kHz, off | Removes high end from the detector. |
| **SC EQ** | 20 Hz to 20 kHz | 1 kHz, off | Centre frequency of a detector bell filter. |
| **EQ Gain** | −18 to +18 dB | 0 dB | Boost or cut at the detector bell. Boost makes that band trigger harder. |
| **EQ Q** | 0.1 to 10 | 1 | Width of the detector bell. |
| **Thrust** | Off · Medium · Loud | Off | Tilts the detector toward high frequencies. |
| **Ext SC** | On / Off | Off | Detects from a routed sidechain source instead of the input. |
| **Detection** | RMS · Peak | RMS | Intended detector integration mode. |
| **OS** | 1× · 2× · 4× | 2× | Oversamples the nonlinear stages. |

> [!WARNING]
> **Not yet active.** SC HPF, SC LPF, SC EQ, EQ Gain, EQ Q, Thrust, and Ext SC reach the detector on
> the **Diode** topology only. On VCA, Opto, and FET the detector listens to the unfiltered input
> and these seven controls have no effect. VCA is the default topology, so ducking one track under
> another requires switching to Diode first.

> [!WARNING]
> **Not yet active.** Detection is stored with the preset but does not change detector behaviour.
> Every topology detects in RMS.

To duck a bass under a kick, switch to the Diode topology, route the kick to this track's sidechain
input, then turn on **Ext SC**.

## Character

The Character section changes with the topology you selected.

**VCA** — **VCA Color** (0 to 0.02, default 0.003) adds nonlinearity to the gain element. **VCA
Type** selects Ideal, THAT 2181, or DBX 202. **Feed-Forward** switches the detector's position:
off is softer and more forgiving, on is tighter and more accurate.

**Opto** — **Limit Mode** leans harder on the modelled cell.

**FET** — **Input Gain** (−12 to +24 dB) and **Output Gain** (−24 to +24 dB) drive the stage and
compensate for it. **Transformer** (0 to 3, default 1.2) sets transformer drive. **Odd** (0 to 0.5,
default 0.15) and **Even** (0 to 0.3, default 0) set harmonic content directly. **All Buttons**
engages the ratio-crush mode.

**Diode** — **Recovery** (1 to 5, default 3) replaces Release on this topology. Lower values grab
harder; higher values relax into the tail.

## Stage two

Stage two runs a second topology **in series** behind the first — the second compressor processes
the first one's output, and **Blend** crossfades between the single-stage and dual-stage result. At
0% the second stage is off entirely, and it stays off if both topologies are the same. A slow
topology behind a fast one is the usual pairing: FET for transients, then VCA or Opto for the
sustained level.

## Meters and readouts

| Readout | Shows |
|---|---|
| **Grab** | Current gain reduction, in dB |
| **Crest** | Peak-to-RMS distance of the output, in dB |
| **Phase** | Stereo correlation |
| **Curve** | Transfer curve with the live input position marked |
| **History** | Rolling gain reduction over time |

Watch **Crest** to see how much transient life compression is costing you. A drop of more than a few
dB usually means the attack is too fast for the source.

## Presets

16 presets in five categories — bus, vocal, drums, mastering, and creative. Loading one replaces
every control, including topology.

## Automation and control

Every control on this page can be automated and appears in automation lanes under the label printed
on the panel. Loading a preset or pressing a Quick move writes many parameters at once and appears
as a single entry in the history panel.

## See also

- [Concepts](../02-concepts.md) — device chains, parameters, and automation
- [Manual index](../README.md) — every chapter and device page
