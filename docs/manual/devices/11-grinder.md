# Grinder — Guitar Amp and Cabinet

Grinder is a guitar rig: drive pedals into an amplifier into a cabinet and microphones. It can run
that chain as a modelled circuit, as a neural capture of a real amp, or as a blend of the two. Use
it on a DI guitar or bass track, or on anything else you want to push through a speaker.

**Type** Audio effect · **Category** Amp and distortion · **Load from** Sidebar → Effects → Grinder

## At a glance

- Five amp voices plus a Custom slot, each with its own tone stack and power section.
- Four drive pedals in a reorderable front-end chain, plus a noise gate.
- Cabinet as impulse response, as a parametric speaker model, or both at once.
- Neural captures — three built in, plus your own NAM files.
- Component-level controls for the preamp, power section, and output transformer.

## First moves

1. Add Grinder to a guitar or bass track and play through it.
2. Pick a preset from the rail down the left side, near the sound you want.
3. Go to **Amp** and set **Gain** for how hard the preamp is driven, **Master** for how hard the
   power section is.
4. Set the **Bass**, **Mid**, **Treble** and **Presence** controls — they behave like the amp they
   belong to, not like an equaliser.
5. In **Cab**, drag the microphone toward the cone edge for more body, toward the centre for more
   bite.

The panel is a rail down the left that never changes, plus six tabs — Browse, Amp, Drive, Cab,
Neural, Lab.

<!-- ac: grinder-stabilization-phase-1/AC-005, grinder-stabilization-phase-2/AC-004, grinder-live-rig-basics-phase-3/AC-002, grinder-live-rig-basics-phase-3/AC-003, grinder-live-rig-basics-phase-3/AC-005, grinder-live-rig-basics-phase-3/AC-007 -->
## The rail, and Browse

The rail holds the three things you reach for between sounds rather than while shaping one: the
preset list, the amp lineup, and — when the loaded patch has any — the snapshot strip. It stays
visible whichever tab you are on. The **Browse** tab itself shows a read-only summary of the loaded
preset; it has no controls.

Eleven presets: Clean Twin, Sparkle Clean, British Crunch, AC30 Jangle, JCM Lead, Rectifier Heavy,
Modern Metal, Time Lead, TS into Crunch, Fuzz into Clean, and Live Rig. Loading one replaces the
whole rig, including the pedal chain and cabinet.

**Amp lineup** picks the voice — see Amp, below.

**Snapshots** store a named set of control overrides and pedal on/off states inside the patch, so one
device can hold a verse and a chorus sound.

> [!WARNING]
> **Not yet active.** You cannot create, name, or save a snapshot. The strip only recalls snapshots
> that a preset already carries, and only the **Live Rig** preset carries any — two, called Clean and
> Drive. The strip is hidden entirely on every other preset.

<!-- ac: grinder-later-amp-stability-phase-6/AC-004, grinder-amp-family-voicing-phase-11/AC-001, grinder-amp-family-voicing-phase-11/AC-002, grinder-amp-family-voicing-phase-11/AC-003, grinder-extreme-gain-decay-phase-13/AC-004 -->
## Amp

**Amp lineup**, on the rail, selects the voice: Clean Twin, Crunch JCM, Lead JCM, AC30 Top Boost,
Rectifier, or Custom. Each brings its own tone-stack topology — Fender, Marshall, or Vox — which is
why the same Mid setting sounds different across models.

| Control | Range | Default | What it does |
|---|---|---|---|
| **Gain** | 0 to 10 | 5 | How hard the preamp is driven. |
| **Master** | 0 to 10 | 5 | How hard the power section is driven. |
| **Bass** | 0 to 10 | 5 | Tone stack low band. |
| **Mid** | 0 to 10 | 5 | Tone stack mid band. |
| **Treble** | 0 to 10 | 5 | Tone stack high band. |
| **Presence** | 0 to 10 | 5 | Upper-mid response in the power section. |
| **Resonance** | 0 to 10 | 5 | Low-end response in the power section. |
| **Bright** | On / Off | Off | Treble lift at low gain, in the manner of a bright cap. |
| **Fat** | On / Off | Off | Low-mid lift into the preamp. |

Under **Voice switches**, three chips — **Clean**, **Crunch**, **Lead** — pick the preamp channel.
Crunch is the default; each step adds a gain stage.

**Bright** interacts with **Gain**: like the real circuit, its lift shrinks as gain rises, so it does
almost nothing on a high-gain setting. The tone stack sits between the preamp and the power amp, so
its controls interact — cutting Mid on a Marshall stack raises the perceived Bass and Treble rather
than leaving them alone.

Two more chip rows set the output stage. **Power tubes** offers `6l6`, `el34`, and `el84`; the
**Rectifier** row offers `tube`, `solid-state`, and `variac`. Tube rectification sags under load and
solid state does not. Both print in the lowercase form above rather than the usual `6L6` / `EL34`
spelling.

> [!NOTE]
> **Alpha.** Power tubes and Rectifier start at `el34` and `tube` and stay there when you change amp
> voice, even though the lineup card for each amp names the tubes it was built around. Set them by
> hand after picking a voice. They are also the only two settings on this page that cannot be
> automated.

<!-- ac: grinder-high-gain-phase-5/AC-001, grinder-high-gain-phase-5/AC-002, grinder-high-gain-phase-5/AC-003, grinder-high-gain-phase-5/AC-004, grinder-stabilization-phase-2/AC-001, grinder-stabilization-phase-2/AC-002, grinder-stabilization-phase-2/AC-008, grinder-stabilization-phase-1/AC-001, grinder-stabilization-phase-1/AC-002, grinder-stabilization-phase-1/AC-003, grinder-stabilization-phase-1/AC-004, grinder-stabilization-phase-2/AC-003, grinder-live-rig-basics-phase-3/AC-001, grinder-live-rig-basics-phase-3/AC-004 -->
## Drive

Four pedals sit in front of the amp: **Compressor**, **Overdrive**, **Distortion**, and **Fuzz**.
Each switches on and off independently, and each has its own controls on this tab.

The chain order is reorderable, and order matters — an overdrive into a distortion is a different
sound from the reverse. The reorder strip appears once the front end holds a pedal; on a bare patch
it tells you so instead. Reordering applies to the front end only.

<!-- ac: grinder-cab-reality-phase-4/AC-001, grinder-cab-reality-phase-4/AC-002, grinder-cab-reality-phase-4/AC-003, grinder-cab-reality-phase-4/AC-004, grinder-routing-cab-phase-9/AC-001, grinder-routing-cab-phase-9/AC-002, grinder-routing-cab-phase-9/AC-003, grinder-routing-cab-phase-9/AC-004, grinder-routing-cab-phase-9/AC-005, grinder-routing-cab-phase-9/AC-006, grinder-modular-rig-graph/AC-013 -->
## Cab

**Cab mode** selects how the speaker is produced: **IR** uses an impulse response, **Parametric**
uses the modelled speaker, and **Both** runs them together. The parametric controls below only bite
in Parametric or Both.

| Control | Range | Default | What it does |
|---|---|---|---|
| **Res Freq** | 40 to 200 Hz | 80 Hz | Cabinet resonance frequency — the box's low thump. |
| **Res Q** | 0.5 to 10 | 2 | How narrow that resonance is. |
| **Damping** | 0 to 1 | 0.5 | How quickly the cone settles. Higher is tighter. |
| **Breakup** | 0 to 1 | 0.3 | Cone breakup — the ragged edge a speaker adds when pushed. |
| **Back EMF** | 0 to 1 | 0.2 | Speaker loading back into the power amp. |
| **Room** | 0 to 1 | 0.1 | How much room sound is mixed in. |

A microphone is placed with three controls: across the cone from centre to edge, on-axis to
off-axis, and close to far. Centre and on-axis is bright and aggressive; edge and off-axis is darker
and rounder. Distance trades directness for room. A second microphone has the same three controls
and appears once it is enabled; it ships disabled.

**Routing preset** selects how the rig is assembled: **Serial**, **Parallel**, **Wet/Dry/Wet**, or
**Dual Amp**.

<!-- ac: grinder-neural-builtins-phase-7/AC-001, grinder-neural-builtins-phase-7/AC-002, grinder-neural-builtins-phase-7/AC-003, grinder-neural-builtins-phase-7/AC-004, grinder-neural-external-models-phase-8/AC-001, grinder-neural-external-models-phase-8/AC-002, grinder-neural-external-models-phase-8/AC-003, grinder-neural-external-models-phase-8/AC-004, grinder-neural-external-models-phase-8/AC-005, grinder-neural-external-models-phase-8/AC-006, grinder-neural-external-models-phase-8/AC-007, grinder-neural-external-models-phase-8/AC-013, grinder-neural-library-management-phase-14/AC-001, grinder-neural-library-management-phase-14/AC-002, grinder-neural-library-management-phase-14/AC-003, grinder-neural-library-management-phase-14/AC-004, grinder-neural-library-management-phase-14/AC-005, grinder-neural-library-management-phase-14/AC-007, grinder-stabilization-phase-2/AC-005, grinder-stabilization-phase-2/AC-006 -->
## Neural

A neural capture is a trained model of a real amp or a whole rig, and it runs in place of — or
alongside — the modelled circuit.

**Engine Mode** decides what is actually making the sound. It lives on this tab, not on Amp, and it
is the choice everything else here depends on:

| Mode | What runs |
|---|---|
| **Circuit** | The modelled amp. Full controls, no capture in the loop. |
| **Capture** | The loaded neural capture, with the amp mostly out of it. |
| **Hybrid** | Both, blended by **Blend**. |

In Capture mode most of the amp controls still move, but the capture is doing the work — a capture
is a snapshot of one amp at one setting, so it does not respond to the gain knob the way the circuit
does.

| Control | Range | Default | What it does |
|---|---|---|---|
| **Blend** | 0 to 1 | 1 | Balance of capture against circuit. Only meaningful in Hybrid. |
| **CPU** | three steps | middle | Caps how much processing captures may use. |

**Capture Role** decides whether the capture stands in for the amp alone (**Amp capture**) or for the
whole rig including the cabinet (**Rig capture**); with a rig capture, turn the cabinet off or you
will hear two speakers.

Three captures ship built in — Factory Amp A, Factory Rig B, and Vintage Stack C. You can import your
own **NAM** files, and the library keeps imported and built-in captures side by side, with removal
and export for the ones you added.

<!-- ac: grinder-later-amp-voicing-phase-10/AC-001, grinder-later-amp-voicing-phase-10/AC-002, grinder-later-amp-voicing-phase-10/AC-005 -->
## Lab

Everything that is neither tone shaping nor a pedal: the noise gate, the power and transformer
behaviour, and the preamp operating point. They are real and automatable, and they are also the
fastest way to make an amp sound wrong. Change one at a time.

The **noise gate** runs at the input, which is where it belongs on a high-gain rig: it silences the
hum before the pedals and the preamp amplify it.

| Control | Range | Default | What it does |
|---|---|---|---|
| **Gate** | −80 to 0 dB | −60 dB | Level below which the signal is silenced. |
| **G Atk** | 0.1 to 50 ms | 2 ms | How quickly the gate opens. |
| **G Rel** | 5 to 500 ms | 120 ms | How quickly it closes. |
| **Bias** | 0 to 1 | 0.5 | Preamp tube operating point. Off-centre values add asymmetric distortion. |

Set the gate by playing nothing and raising the threshold until the hiss stops, then backing off
until quiet notes survive. Long release times let chords ring out; short ones tighten palm mutes.

<!-- ac: grinder-later-amp-stability-phase-6/AC-001, grinder-later-amp-stability-phase-6/AC-005, grinder-later-amp-voicing-phase-10/AC-003, grinder-extreme-gain-decay-phase-13/AC-001, grinder-extreme-gain-decay-phase-13/AC-002, grinder-extreme-gain-decay-phase-13/AC-003, grinder-extreme-gain-decay-phase-13/AC-008, grinder-extreme-gain-decay-phase-13/AC-009 -->
### Power and transformer

| Control | Range | Default | What it does |
|---|---|---|---|
| **Sag** | 0 to 1 | 0.4 | How much the supply drops on transients. |
| **Recovery** | 10 to 2000 ms | 200 ms | How quickly it recovers. Long values give the bloom after a hard chord. |
| **NFB** | 0 to 1 | 0.5 | Negative feedback. Less feedback is looser and more harmonically open. |
| **Drive** | 0 to 1 | 0.3 | Output transformer drive. |
| **Hyst** | 0 to 1 | 0.3 | Transformer magnetic memory. Adds thickness and slight compression. |
| **LF Sat** | 0 to 1 | 0.3 | Low-frequency transformer saturation. |

Sag and NFB are where "feel" lives. If a high-gain setting sounds fast and stiff rather than
springy, raise Sag and lower NFB before touching the tone controls.

## Controls with no knob

Twelve parameters shape the rig and are fully live in the audio path, but have no control anywhere on
the panel. You reach them from an automation lane or the modulation matrix, by the names below, and
nowhere else. A static value set in a lane works fine.

| Parameter | Range | Default | What it does |
|---|---|---|---|
| **Input Gain** | −24 to +24 dB | 0 dB | Level into the rig. Raise it to hit the front end harder. |
| **Input Impedance** | 10 to 10000 kΩ | 1000 kΩ | Input loading. Lower values roll off highs the way a low-impedance pedal does. |
| **Mic Blend** | 0 to 1 | 0 | Balance between the two microphones. |
| **Tube Age** | 0 to 1 | 0 | Wear. Softens attack and loses headroom. |
| **Miller Cap** | 0 to 1 | 0.5 | Preamp high-frequency rolloff from Miller capacitance. |
| **Grid Cond** | 0 to 1 | 0.5 | Grid conduction — how the stage blocks and recovers when overdriven. |
| **Coupling Cap** | 0 to 1 | 0.5 | Coupling capacitor charge behaviour between stages. |
| **PA Bias** | 0 to 1 | 0.5 | Power amp bias. Toward crossover distortion at the extremes. |
| **Output Gain** | −24 to +24 dB | 0 dB | Level leaving the device. |
| **Mix** | 0 to 1 | 1 | Wet/dry blend across the whole rig. |
| **Clean Blend** | 0 to 1 | 0 | Mixes the unprocessed input back in, under the distortion. |
| **Limiter** | −12 to 0 dB | −0.3 dB | Output ceiling. Catches peaks a hot rig produces. |

Clean Blend is the standard bass trick: distort the whole signal, then bring the clean low end back
underneath it.

## Automation and control

41 parameters can be automated — every control on this page except the Power tubes and Rectifier
chips, which are not automatable, plus Engine Mode and the twelve above.

Automation lanes do not always use the label the panel prints. Where they differ:

| On the panel | In automation lanes |
|---|---|
| Res Freq · Res Q | Cab Res · Cab Q |
| Blend · CPU | Neural Mix · CPU Budget |
| G Atk · G Rel | Gate Atk · Gate Rel |
| Recovery · Drive · Hyst | Sag Recovery · Xfmr Drive · Hysteresis |
| Bias | Tube Bias |
| Voice switch chips | Channel |

> [!WARNING]
> **Not yet active.** Grinder changes you make by hand are not recorded in the history panel and
> cannot be undone. Turning a knob, loading a preset, and recalling a snapshot all apply immediately
> and permanently. Duplicate the track before you experiment.
>
> Asking the assistant for the same parameter change is the exception, and it is the only route
> Grinder has into history: that change is recorded and undo reverses it in the project and in the
> sound.
>
> **The panel is not on that route at all.** Grinder's controls are drawn from state only its own
> panel writes, and the assistant's change does not go through the panel — so you hear the change
> while the knob still shows the value from before it, and when you undo you hear that reversed
> while the knob still has not moved. Closing and reopening Grinder does not resync it; nothing
> reads the project back into those controls. **This is a defect and is being fixed**, not how the
> device is meant to work.

## See also

- [Concepts](../02-concepts.md) — device chains, parameters, and automation
- [Gluten](./07-gluten.md) — compression, useful before or after a rig
- [Manual index](../README.md) — every chapter and device page
