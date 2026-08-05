# Grinder — Guitar Amp and Cabinet

Grinder is a guitar rig: drive pedals into an amplifier into a cabinet and microphones. It can run
that chain as a modelled circuit, as a neural capture of a real amp, or as a blend of the two. Use
it on a DI guitar or bass track, or on anything else you want to push through a speaker.

**Type** Audio effect · **Category** Amp and distortion · **Load from** Sidebar → Effects → Grinder

## At a glance

- Five amp voices plus a Custom slot, each with its own tone stack and power section.
- Four drive pedals in a reorderable front-end chain, plus a noise gate.
- Cabinet as impulse response, as a parametric speaker model, or both at once.
- Neural captures — five built in, plus your own NAM files.
- Snapshots for switching whole rigs mid-song.

## First moves

1. Add Grinder to a guitar or bass track and play through it.
2. Open **Browse** and load a preset near the sound you want.
3. Go to **Amp** and set **Gain** for how hard the preamp is driven, **Master** for how hard the
   power section is.
4. Set the **Bass**, **Mid**, **Treble** and **Presence** controls — they behave like the amp they
   belong to, not like an equaliser.
5. In **Cab**, drag the microphone toward the cone edge for more body, toward the centre for more
   bite.

The panel is six tabs — Browse, Amp, Drive, Cab, Neural, Lab — and they run roughly in signal
order, apart from Browse.

<!-- ac: grinder-stabilization-phase-1/AC-005, grinder-stabilization-phase-2/AC-004, grinder-live-rig-basics-phase-3/AC-002, grinder-live-rig-basics-phase-3/AC-003, grinder-live-rig-basics-phase-3/AC-005, grinder-live-rig-basics-phase-3/AC-007 -->
## Browse

Eleven presets: Clean Twin, Sparkle Clean, British Crunch, AC30 Jangle, JCM Lead, Rectifier Heavy,
Modern Metal, Time Lead, TS into Crunch, Fuzz into Clean, and Live Rig. Loading one replaces the
whole rig, including the pedal chain and cabinet.

**Snapshots** store a named set of control overrides and pedal on/off states inside the current
patch. Use them for a verse and a chorus sound in one device rather than automating twenty
controls. Switching a snapshot is one step in the history.

<!-- ac: grinder-later-amp-stability-phase-6/AC-004, grinder-amp-family-voicing-phase-11/AC-001, grinder-amp-family-voicing-phase-11/AC-002, grinder-amp-family-voicing-phase-11/AC-003, grinder-extreme-gain-decay-phase-13/AC-004 -->
## Amp

**Engine mode** decides what is actually making the sound, and it is the first choice on this page:

| Mode | What runs |
|---|---|
| **Circuit** | The modelled amp. Full controls, no capture in the loop. |
| **Capture** | The loaded neural capture, with the amp mostly out of it. |
| **Hybrid** | Both, blended by **Neural Mix**. |

In Capture mode most of the controls below still move, but the capture is doing the work — a
capture is a snapshot of one amp at one setting, so it does not respond to the gain knob the way
the circuit does.

**Amp model** selects the voice: Clean Twin, Crunch JCM, Lead JCM, AC30 Top Boost, Rectifier, or
Custom. Each brings its own tone-stack topology — Fender, Marshall, or Vox — which is why the same
Mid setting sounds different across models.

| Control | Range | Default | What it does |
|---|---|---|---|
| **Input** | −24 to +24 dB | 0 dB | Level into the rig. Raise it to hit the front end harder. |
| **Impedance** | 10 to 10000 kΩ | 1000 kΩ | Input loading. Lower values roll off highs the way a low-impedance pedal does. |
| **Channel** | Clean · Crunch · Lead | Crunch | Preamp channel. |
| **Gain** | 0 to 10 | 5 | How hard the preamp is driven. |
| **Bright** | On / Off | Off | Treble lift at low gain, in the manner of a bright cap. |
| **Fat** | On / Off | Off | Low-mid lift into the preamp. |
| **Bass** | 0 to 10 | 5 | Tone stack low band. |
| **Mid** | 0 to 10 | 5 | Tone stack mid band. |
| **Treble** | 0 to 10 | 5 | Tone stack high band. |
| **Presence** | 0 to 10 | 5 | Upper-mid response in the power section. |
| **Resonance** | 0 to 10 | 5 | Low-end response in the power section. |
| **Master** | 0 to 10 | 5 | How hard the power section is driven. |

**Bright** interacts with **Gain**: like the real circuit, its lift shrinks as gain rises, so it does
almost nothing on a high-gain setting. The tone stack sits between the preamp and the power amp, so
its controls interact — cutting Mid on a Marshall stack raises the perceived Bass and Treble rather
than leaving them alone.

<!-- ac: grinder-later-amp-stability-phase-6/AC-001, grinder-later-amp-stability-phase-6/AC-005, grinder-later-amp-voicing-phase-10/AC-003, grinder-extreme-gain-decay-phase-13/AC-001, grinder-extreme-gain-decay-phase-13/AC-002, grinder-extreme-gain-decay-phase-13/AC-003, grinder-extreme-gain-decay-phase-13/AC-008, grinder-extreme-gain-decay-phase-13/AC-009 -->
### Power section

| Control | Range | Default | What it does |
|---|---|---|---|
| **Power tubes** | 6L6 · EL34 · EL84 | per amp model | Output tube type. Changes distortion character and headroom. |
| **Rectifier** | Tube · Solid state · Variac | per amp model | Supply behaviour. Tube sags under load; solid state does not. |
| **Sag** | 0 to 1 | 0.4 | How much the supply drops on transients. |
| **Sag Recovery** | 10 to 2000 ms | 200 ms | How quickly it recovers. Long values give the bloom after a hard chord. |
| **NFB** | 0 to 1 | 0.5 | Negative feedback. Less feedback is looser and more harmonically open. |
| **Xfmr Drive** | 0 to 1 | 0.3 | Output transformer drive. |
| **Hysteresis** | 0 to 1 | 0.3 | Transformer magnetic memory. Adds thickness and slight compression. |
| **LF Sat** | 0 to 1 | 0.3 | Low-frequency transformer saturation. |

Sag and NFB are where "feel" lives. If a high-gain setting sounds fast and stiff rather than
springy, raise Sag and lower NFB before touching the tone controls.

<!-- ac: grinder-high-gain-phase-5/AC-001, grinder-high-gain-phase-5/AC-002, grinder-high-gain-phase-5/AC-003, grinder-high-gain-phase-5/AC-004, grinder-stabilization-phase-2/AC-001, grinder-stabilization-phase-2/AC-002, grinder-stabilization-phase-2/AC-008, grinder-stabilization-phase-1/AC-001, grinder-stabilization-phase-1/AC-002, grinder-stabilization-phase-1/AC-003, grinder-stabilization-phase-1/AC-004, grinder-stabilization-phase-2/AC-003, grinder-live-rig-basics-phase-3/AC-001, grinder-live-rig-basics-phase-3/AC-004 -->
## Drive

Four pedals sit in front of the amp: **Compressor**, **Overdrive**, **Distortion**, and **Fuzz**.
Each switches on and off independently, and the chain order is reorderable — order matters, since
an overdrive into a distortion is a different sound from the reverse.

The **noise gate** runs at the input, which is where it belongs on a high-gain rig: it silences the
hum before the preamp amplifies it.

| Control | Range | Default | What it does |
|---|---|---|---|
| **Gate** | −80 to 0 dB | −60 dB | Level below which the signal is silenced. |
| **Gate Atk** | 0.1 to 50 ms | 0.5 ms | How quickly the gate opens. |
| **Gate Rel** | 5 to 500 ms | 50 ms | How quickly it closes. |

Set the gate by playing nothing and raising the threshold until the hiss stops, then backing off
until quiet notes survive. Long release times let chords ring out; short ones tighten palm mutes.

<!-- ac: grinder-cab-reality-phase-4/AC-001, grinder-cab-reality-phase-4/AC-002, grinder-cab-reality-phase-4/AC-003, grinder-cab-reality-phase-4/AC-004, grinder-routing-cab-phase-9/AC-001, grinder-routing-cab-phase-9/AC-002, grinder-routing-cab-phase-9/AC-003, grinder-routing-cab-phase-9/AC-004, grinder-routing-cab-phase-9/AC-005, grinder-routing-cab-phase-9/AC-006, grinder-modular-rig-graph/AC-013 -->
## Cab

**Cab mode** selects how the speaker is produced: **IR** uses an impulse response, **Parametric**
uses the modelled speaker, and **Both** runs them together. The parametric controls below only bite
in Parametric or Both.

| Control | Range | Default | What it does |
|---|---|---|---|
| **Cab Res** | 40 to 200 Hz | 80 Hz | Cabinet resonance frequency — the box's low thump. |
| **Cab Q** | 0.5 to 10 | 2 | How narrow that resonance is. |
| **Damping** | 0 to 1 | 0.5 | How quickly the cone settles. Higher is tighter. |
| **Breakup** | 0 to 1 | 0.3 | Cone breakup — the ragged edge a speaker adds when pushed. |
| **Back EMF** | 0 to 1 | 0.2 | Speaker loading back into the power amp. |
| **Mic Blend** | 0 to 1 | 0 | Balance between the two microphones. |
| **Room** | 0 to 1 | 0.1 | How much room sound is mixed in. |

Microphones are **Dynamic**, **Ribbon**, **Condenser**, or **Room**, each with its own position:
across the cone from centre to edge, on-axis to off-axis, and close to far. Centre and on-axis is
bright and aggressive; edge and off-axis is darker and rounder. Distance trades directness for room.

**Routing** selects how the rig is assembled: **Serial**, **Parallel**, **Wet-dry-wet**, or
**Dual amp**.

<!-- ac: grinder-neural-builtins-phase-7/AC-001, grinder-neural-builtins-phase-7/AC-002, grinder-neural-builtins-phase-7/AC-003, grinder-neural-builtins-phase-7/AC-004, grinder-neural-external-models-phase-8/AC-001, grinder-neural-external-models-phase-8/AC-002, grinder-neural-external-models-phase-8/AC-003, grinder-neural-external-models-phase-8/AC-004, grinder-neural-external-models-phase-8/AC-005, grinder-neural-external-models-phase-8/AC-006, grinder-neural-external-models-phase-8/AC-007, grinder-neural-external-models-phase-8/AC-013, grinder-neural-library-management-phase-14/AC-001, grinder-neural-library-management-phase-14/AC-002, grinder-neural-library-management-phase-14/AC-003, grinder-neural-library-management-phase-14/AC-004, grinder-neural-library-management-phase-14/AC-005, grinder-neural-library-management-phase-14/AC-007, grinder-stabilization-phase-2/AC-005, grinder-stabilization-phase-2/AC-006 -->
## Neural

A neural capture is a trained model of a real amp or a whole rig, and it runs in place of — or
alongside — the modelled circuit.

| Control | Range | Default | What it does |
|---|---|---|---|
| **Neural Mix** | 0 to 1 | 1 | Blend of capture against circuit. Only meaningful in Hybrid. |
| **CPU Budget** | three steps | middle | Caps how much processing captures may use. |

**Tier** selects model size — Standard, Lite, Nano, or Recurrent — trading fidelity for cost.
**Placement** decides whether the capture stands in for the amp alone or for the whole rig
including the cabinet; with a rig capture, turn the cabinet off or you will hear two speakers.

Five captures ship built in. You can import your own **NAM** files, and the library keeps imported
and built-in captures side by side, with removal and export for the ones you added.

<!-- ac: grinder-later-amp-voicing-phase-10/AC-001, grinder-later-amp-voicing-phase-10/AC-002, grinder-later-amp-voicing-phase-10/AC-005 -->
## Lab

Component-level controls. They are real and automatable, and they are also the fastest way to make
an amp sound wrong. Change one at a time.

| Control | Range | Default | What it does |
|---|---|---|---|
| **Tube Bias** | 0 to 1 | 0.5 | Preamp tube operating point. Off-centre values add asymmetric distortion. |
| **Tube Age** | 0 to 1 | 0 | Wear. Softens attack and loses headroom. |
| **Miller Cap** | 0 to 1 | 0.5 | Preamp high-frequency rolloff from Miller capacitance. |
| **Grid Cond** | 0 to 1 | 0.5 | Grid conduction — how the stage blocks and recovers when overdriven. |
| **Coupling Cap** | 0 to 1 | 0.5 | Coupling capacitor charge behaviour between stages. |
| **PA Bias** | 0 to 1 | 0.5 | Power amp bias. Toward crossover distortion at the extremes. |

## Output

| Control | Range | Default | What it does |
|---|---|---|---|
| **Output** | −24 to +24 dB | 0 dB | Level leaving the device. |
| **Mix** | 0 to 1 | 1 | Wet/dry blend across the whole rig. |
| **Clean Blend** | 0 to 1 | 0 | Mixes the unprocessed input back in, under the distortion. |
| **Limiter** | −12 to 0 dB | −0.3 dB | Output ceiling. Catches peaks a hot rig produces. |

Clean Blend is the standard bass trick: distort the whole signal, then bring the clean low end back
underneath it.

## Automation and control

All 41 controls listed here can be automated and appear in automation lanes under the label printed
on the panel — including the Lab controls, which have no dedicated knob on some layouts but are
reachable from the modulation matrix. Loading a preset or switching a snapshot writes many
parameters at once and appears as a single entry in the history panel.

## See also

- [Concepts](../02-concepts.md) — device chains, parameters, and automation
- [Gluten](./07-gluten.md) — compression, useful before or after a rig
- [Manual index](../README.md) — every chapter and device page
