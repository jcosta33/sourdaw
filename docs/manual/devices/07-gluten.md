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
subset of the controls. The ones it does not read stay in place and go grey, and hovering one tells
you which topology cannot hear it and why — so the layout never shifts under you when you switch,
and a knob that does nothing is never mistaken for a knob that is broken. Greying refuses your hand
only: automation lanes, saved values, and anything already drawn are untouched.

| Topology | Character | Shaped by |
|---|---|---|
| **VCA** | Clean, disciplined, predictable | Threshold, Ratio, Knee, Attack, Release, Auto rel, Range, Color, VCA type, Feedback / Feed forward |
| **Opto** | Slow, self-levelling, forgiving | Threshold, Compress / Limit |
| **FET** | Fast, aggressive, harmonically rich | Threshold, Ratio, Attack, Release, OS, Input, Output, Xfmr, Odd, Even, All buttons |
| **Diode** | Dense and weighty | Threshold, Ratio, Attack, Recovery, OS, and the sidechain filters |

Opto ignores Ratio, Attack, Release, Auto rel, Knee, Range, and OS entirely — its timing comes from
the modelled cell, and Threshold is the only shaping control you have. If you want to dial timing by
hand, pick another topology.

Stage two reopens any of them. A control the first topology cannot hear goes live again the moment
**Stage 2** is above zero with a topology behind it that can — Release on Diode with VCA in stage
two is a real control, and the panel treats it as one.

Two controls read a narrower range on some topologies than the knob offers. **Attack** spans
0.02–250 ms on the knob, but FET only accepts 0.02–2 ms and Diode only 0.5–30 ms — turn Attack past
those points on those topologies and the sound stops changing. **Ratio** likewise tops out at 6:1 on
Diode. Both are deliberate: the modelled hardware had no more range than that.

## Quick moves

The four Quick move buttons — Glue, Punch, Smooth, Pump — are one-click starting points, not
modifiers. Each one rewrites Topology, Threshold, Ratio, Attack, Release, and several other controls
at once. Use one as a departure point, then adjust.

## Clamp

| Control | Range | Default | What it does |
|---|---|---|---|
| **Threshold** | −60 to 0 dB | −18 dB | Level above which gain reduction begins. Draggable directly on the curve. |
| **Ratio** | 1:1 to 20:1 | 4:1 | How hard signal above the threshold is reduced. Diode reads only 1.5:1 to 6:1. |
| **Knee** | 0 to 30 dB | 6 dB | Width of the soft transition around the threshold. VCA only. |
| **Attack** | 0.02 to 250 ms | 10 ms | How quickly reduction engages. Ignored by Opto; FET reads only 0.02–2 ms and Diode only 0.5–30 ms. |
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
| **Link** | 0 to 100% | 100% | How much the two channels share one detector reading. |
| **Look** | 0 to 20 ms | 0 ms | Delays the audio so reduction starts before the transient. |
| **Stage 2** | 0 to 100% | 0% | Blends in the second topology. See Stage two, below. |
| **Auto rel** | On / Off | On | Adapts release to the material. VCA only. |
| **Auto gain** | On / Off | Off | Estimates makeup gain from Threshold and Ratio. |
| **Delta** | On / Off | Off | Monitors only what compression removed. |
| **Match** | On / Off | Off | Level-matches the bypassed signal to the processed one. |

**Mix** blends against the lookahead-delayed dry signal, so parallel settings stay phase-aligned at
any **Look** value. **Match** acts only while the device is bypassed — it is for honest A/B, not for
setting output level. It is the one control that does nothing in the device's ordinary running state
and is still left fully live, because greying it whenever the device is *not* bypassed would hide it
for almost the whole session.

**Stage 2** goes grey when the Stage two section names the topology you already selected as the
primary — the second stage only runs when the two differ. Stage two starts on Opto, so selecting
Opto as your primary is enough to reach that state; pick a different topology in Stage two and the
knob comes back.

**Link** is on the detector, never on the output. At 100% both channels read the louder of the two
and duck together, so the stereo image stays put — this is what you want on a bus. At 0% each
channel gets its own reading and they breathe independently, which widens the image and can pull it
off centre when one side is much louder. Anything in between blends the two readings. It applies on
all four topologies — but not under **Dual mono**, which *is* an unlinked detector, so Link goes
grey while that stereo mode is selected.

## Detector

The Detector section shapes what the compressor listens to, without changing what you hear.

| Control | Range | Default | What it does |
|---|---|---|---|
| **SC HPF** | 20 Hz to 500 Hz | 80 Hz | Removes low end from the detector so bass stops driving reduction. Switched by the **HPF** toggle, on by default. |
| **SC LPF** | 1 kHz to 20 kHz | 20 kHz | Removes high end from the detector. Switched by the **LPF** toggle, off by default. |
| **SC EQ** | 20 Hz to 20 kHz | 1 kHz | Centre frequency of a detector bell filter. Switched by the **SC EQ** toggle, off by default. |
| **EQ Gain** | −18 to +18 dB | 0 dB | Boost or cut at the detector bell. Boost makes that band trigger harder. |
| **EQ Q** | 0.1 to 10 | 1 | Width of the detector bell. |
| **Thrust off · Thrust med · Thrust loud** | — | Thrust off | Tilts the detector toward high frequencies. |
| **Ext SC** | On / Off | Off | Detects from a routed sidechain source instead of the input. |
| **RMS · PEAK** | — | RMS | What the detector measures. RMS averages over 10 ms and follows loudness; PEAK reacts to the instant. |
| **Stereo · Mid · Side · Dual mono** | — | Stereo | Which part of the stereo image is compressed. Dual mono also forces Link to 0. |
| **OS** | 1× · 2× · 4× | 2× | Oversamples the nonlinear stages. FET and Diode only — the VCA's stage is not oversampled yet, and Opto has no nonlinearity to oversample. |

The bell is a no-op until **EQ Gain** leaves 0 dB, so **SC EQ** and **EQ Q** go grey until you move
it — set the gain first, then centre and narrow.

> [!WARNING]
> **Not yet active off Diode.** All twelve controls in this section — SC HPF, SC LPF, SC EQ, EQ
> Gain, EQ Q, the HPF, LPF, SC EQ and Ext SC toggles, and the three Thrust chips — shape a detector
> signal only the **Diode** topology reads. On VCA, Opto, and FET the detector listens to the
> unfiltered input, so all twelve go grey and say so. VCA is the default topology, so ducking one
> track under another means selecting Diode first — or running Diode in **Stage two**, which brings
> the whole section back on any primary.

RMS is the default and the usual choice for glue: it ignores single transients and follows how loud
the material actually is. Switch to PEAK when you need the compressor to catch the transient itself
— a slapped bass, a snare crack. The two also change how Attack reads, since peak detection reaches
the threshold sooner.

To duck a bass under a kick, switch to the Diode topology, route the kick to this track's sidechain
input, then turn on **Ext SC**.

## Character

The Character section changes with the topology you selected. When **Stage 2** is above zero it
shows the second topology's controls as well, under their own headings — the second stage is a real
compressor and hears its own controls, so a Diode running behind a VCA has its Recovery switch here
even though Diode is not the primary.

**VCA** — **Color** (0 to 0.02, default 0.003) adds nonlinearity to the gain element. **VCA type**
selects Ideal, THAT 2181, or DBX 202, and starts on THAT 2181. **Feedback / Feed forward** switches
the detector's position: Feedback is softer and more forgiving, Feed forward is tighter and more
accurate.

**Opto** — **Compress / Limit** leans harder on the modelled cell.

**FET** — **Input** (−12 to +24 dB) and **Output** (−24 to +24 dB) drive the stage and compensate
for it. **Xfmr** (0 to 3, default 1.2) sets transformer drive. **Odd** (0 to 0.5, default 0.15) and
**Even** (0 to 0.3, default 0) set harmonic content directly. **All buttons** engages the
ratio-crush mode.

**Diode** — **Recovery 1** to **Recovery 5** (default 3) replaces Release on this topology, and the
Release knob and **Auto rel** go grey while Diode is selected to say so. Each position is a fixed
release time: 50 ms, 100 ms, 400 ms, 800 ms, and 1.5 s. Low positions let the level spring back
between hits; high positions hold the reduction through the tail and pump more.

## Stage two

Stage two runs a second topology **in series** behind the first — the second compressor processes
the first one's output, and **Stage 2** in the Finish section crossfades between the single-stage
and dual-stage result. At 0% the second stage is off entirely.

The Stage two section picks which topology runs second. It offers the three you have not already
selected, so the two stages are always different; the pair defaults to Opto. Changing the first
topology re-offers the list. A slow topology behind a fast one is the usual pairing: FET for
transients, then VCA or Opto for the sustained level.

## Meters and readouts

| Readout | Shows |
|---|---|
| **Grab** | Current gain reduction, in dB |
| **Crest** | Peak-to-RMS distance of the output, in dB |
| **Phase** | Stereo correlation — a number, or `Mono` above +0.99 and `OOP` below −0.99 |
| **Latency** | Delay the device is adding, in samples. Rises with **Look** and is otherwise 0 |
| Transfer curve | The compression curve with the live input position marked. Drag it to set Threshold |
| Gain reduction history | Rolling gain reduction over time |

Watch **Crest** to see how much transient life compression is costing you. A drop of more than a few
dB usually means the attack is too fast for the source.

## Presets

16 presets in five categories — bus, vocal, drums, mastering, and creative. Loading one replaces
every control, including topology.

## Automation and control

Every control on this page can be automated.

Automation lanes do not use the short labels the panel prints — they use longer names, and for some
controls the name is the only way to tell which lane is which:

| On the panel | In automation lanes |
|---|---|
| Link · Look · Stage 2 | Stereo Link · Lookahead · Blend |
| Auto rel · Auto gain · Delta · Match | Auto Release · Auto Makeup · Delta Listen · Gain Match |
| Input · Output · Xfmr · All buttons | Input Gain · Output Gain · Transformer · All Buttons |
| Color · VCA type · Feedback / Feed forward | VCA Color · VCA Type · Feed-Forward |
| RMS / PEAK · Stereo / Mid / Side / Dual mono | Detection · Stereo Mode |
| Thrust off / med / loud · Compress / Limit | Thrust · Limit Mode |
| HPF · LPF · SC EQ toggles | SC HPF On · SC LPF On · SC EQ On |
| Quick moves · Stage two chooser | Style · Blend Topo |

> [!WARNING]
> **Not yet active.** Loading a preset and pressing a Quick move are not recorded in the history
> panel and cannot be undone — they apply immediately and permanently. Individual control moves
> *are* recorded: one drag is one step, however far it travelled, and undo restores the saved value
> and the sound.
>
> **The panel does not follow it, and closing Gluten does not help.** The knob keeps drawing the
> value you dragged to while you hear the value undo restored. Gluten's controls are drawn from
> state its own panel writes and nothing else — nothing reads the project back into it — so
> reopening the device redraws the same stale value. Once the face and the sound disagree they stay
> that way for the rest of the session. **This is a defect and is being fixed**, not how the device
> is meant to work.
>
> History entries for Gluten are labelled with the internal parameter name rather than the name on
> the panel, so an undone HPF switch reads `Set scHpfEnabled` — neither the panel's HPF nor the
> lane's SC HPF On. Save a preset before you load another one.

## See also

- [Concepts](../02-concepts.md) — device chains, parameters, and automation
- [Manual index](../README.md) — every chapter and device page
