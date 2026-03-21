# Building a professional instrument suite for a DAW with free resources

**The bottom line: a commercial DAW can ship instruments approaching professional quality using only freely-licensed resources — but the achievable quality varies dramatically by category.** Synthesis-based instruments (analog synths, organs, 808 drums, pads) can genuinely match or exceed Logic Pro's equivalents via Faust compiled to WebAssembly. Sampled instruments are more constrained: acoustic piano and drum kits have strong CC0 options, bass guitar is well-served, but orchestral strings/brass, choir, and Mellotron face significant gaps. The honest assessment is that **~60% of a Logic Pro-caliber instrument suite is achievable today with free resources**, with synthesis filling most of the remaining gaps creatively rather than as direct replacements.

This guide covers every instrument category with verified license information, SFZ code structures, Faust synthesis examples, and honest gap analysis against Logic Pro's built-in library.

---

## The technology stack and its constraints

The DAW architecture — sfizz compiled to WebAssembly for sample playback, Faust compiled via faust2wam for synthesis, and Rust/Tauri with the symphonia crate for disk I/O — is well-suited for this task, but imposes specific constraints that shape every instrument design decision.

**sfizz WASM opcode support is excellent.** The engine supports **96% of SFZ v1** and 44% of SFZ v2 opcodes. All critical professional instrument opcodes work: `seq_length`/`seq_position` for round-robin, `sw_last`/`sw_lokey`/`sw_hikey` for keyswitches, `xfin_locc`/`xfin_hicc`/`xfout_locc`/`xfout_hicc` for CC crossfading, `group`/`off_by`/`off_mode` for choke groups, `trigger=release`/`trigger=first`/`trigger=legato` for advanced trigger modes, full DAHDSR envelopes, flex EGs, filters, and loop controls. The `sw_label` ARIA extension works for UI labeling. FLAC decoding is built-in, which is critical for download size.

**Memory is the primary WASM constraint.** With no disk streaming available in the browser sandbox (sfizz's background loader is deactivated in WASM builds), all samples must reside in memory. Practical limits are **~1.5–2.5 GB of decoded PCM** depending on browser. FLAC saves download bandwidth but not runtime memory, since samples are decoded to PCM on load. The recommended architecture uses Tauri's Rust backend to decode FLAC via the symphonia crate and transfer decoded PCM buffers to the WASM virtual filesystem via IPC, enabling a "simulated streaming" pipeline where samples are loaded instrument-by-instrument rather than all at once.

**Faust's synthesis capabilities are research-grade.** The oscillator library provides bandlimited sawtooth, square, and triangle waves via PTR (Polynomial Transition Regions) and PolyBLEP methods — both anti-aliased approaches from Stanford CCRMA publications. The virtual analog filter library includes **Moog ladder** (TPT, self-oscillates at Q≥25), **diode ladder**, **Korg 35** (MS-20), **Oberheim** (with internal soft-clipping), and **Sallen-Key** models, all based on Zavalishin's _The Art of VA Filter Design_. The `faust2wam` toolchain compiles these to WAM 2.0 plugins with MIDI polyphony support (`declare options "[midi:on][nvoices:12]"`) and automatic voice allocation.

---

## Acoustic piano: the strongest sampled instrument category

Two CC0/CC-BY piano libraries make this the most achievable high-quality sampled instrument.

**Salamander Grand Piano** remains the workhorse recommendation. Licensed CC-BY-3.0 (the creator stated public domain intent in 2022, but the formal license remains CC-BY), it provides **16 velocity layers** of a Yamaha C5 Grand sampled at minor-third intervals, with hammer noise releases, string resonance releases (3 layers), and pedal noise samples. Available in multiple formats: SFZ+FLAC at **707 MB** (48kHz/24-bit), SFZ+WAV at 394 MB (44.1kHz/16-bit), or SF2 at 296 MB. The sfzinstruments GitHub repository includes an ARIA-extended version with string resonance simulation, though some ARIA-specific opcodes need simplification for sfizz compatibility. Quality is widely praised for pop/rock contexts, though it lacks the per-note timbral variation of a top-tier commercial piano. No round-robins exist, which means repeated notes sound slightly mechanical.

**Sofia MZ Pianos** are the premium option. Licensed CC-BY, these include a Hamburg Steinway D, Fazioli F308, Bösendorfer Imperial, and more, each with **20 velocity layers**, pedal-up and pedal-down samples, simulated half-pedal and soft pedal, and 1,211 samples per piano at 24-bit/48kHz. At **4.3 GB per piano**, they're large but approach Logic Pro's depth. Some SFZ opcodes used (curve_index, sustain_cc, ampeg_dynamic) may need cleanup for sfizz compatibility.

**Splendid Grand Piano** (public domain, Akai-released Steinway) offers only 4 velocity layers in **77 MB** (FLAC), making it ideal as a lightweight fallback.

The SFZ structure for a professional piano requires layered regions for velocity-switched attack samples, separate groups for pedal-up and pedal-down states (filtered by `locc64`/`hicc64`), release trigger groups with `rt_decay` for natural decay behavior, pedal noise regions triggered by `on_locc64`/`on_hicc64`, and sympathetic resonance regions that play on release when the sustain pedal is held. Here is the core structure:

```sfz
<control>
default_path=samples/

<global>
ampeg_release=0.8
amp_veltrack=80

// Attack layers (pedal up) — show 2 of 16 velocity layers
<group> trigger=attack hicc64=63
<region> sample=C4_v01.flac lokey=59 hikey=63 pitch_keycenter=60 lovel=1 hivel=8
<region> sample=C4_v02.flac lokey=59 hikey=63 pitch_keycenter=60 lovel=9 hivel=16
// ... layers 3–16 ...

// Release samples (damper return)
<group> trigger=release rt_decay=6 note_polyphony=1
ampeg_attack=0.01 ampeg_decay=0.5 ampeg_sustain=0
<region> sample=C4_rel.flac lokey=59 hikey=63 pitch_keycenter=60

// Pedal noise
<group> on_locc64=100 on_hicc64=127 loop_mode=one_shot
<region> sample=pedal_down_1.flac key=0
<region> sample=pedal_down_2.flac key=0 seq_length=2 seq_position=2

// Sympathetic resonance (when pedal held)
<group> trigger=release locc64=64 volume=-12
ampeg_attack=0.1 ampeg_release=3.0 note_polyphony=1
<region> sample=C4_resonance.flac lokey=59 hikey=63 pitch_keycenter=60
```

**Gap vs Logic Pro:** Logic's Studio Piano has **24 velocity layers** (vs 16–20 in free options), **3 mic positions** (vs 1), true sustain-pedal-down sample sets, and advanced sympathetic resonance modeling. The gap is audible in exposed solo piano but manageable in a mix context. Physical modeling piano via Faust's STK-based `piano.dsp` is suitable only as a lo-fi/experimental option — even Pianoteq (the commercial gold standard for PM piano) took 15+ years of R&D.

**Recommended bundle:** Salamander Grand (394 MB 16-bit) as primary, Sofia MZ Steinway D as optional high-quality download, Splendid Grand as lightweight fallback.

---

## Electric piano and organs: synthesis wins decisively

For Rhodes, Wurlitzer, and Hammond B3, **Faust synthesis is the recommended primary approach** — and in many cases the superior one.

**No CC0 Rhodes sample library exists.** The best free Rhodes (jRhodes3, a 1977 Mark I with 5 velocity layers) is CC-BY-NC-4.0, which explicitly prohibits commercial redistribution. Keyzone Classic is proprietary freeware. VCSL contains no electric pianos. This makes FM synthesis the only viable approach for commercial bundling.

Rhodes tone is fundamentally a 2-carrier FM architecture — the DX7's "E.Piano 1" patch proved this decades ago. A Faust implementation uses velocity-controlled modulation index (low velocity = pure sine warmth, high velocity = characteristic "bark" overtones) with separate body and bell components having different decay times:

```faust
declare options "[midi:on][nvoices:8]";
import("stdfaust.lib");
freq = hslider("freq", 440, 50, 2000, 0.01);
gain = hslider("gain", 0.5, 0, 1, 0.01);
gate = button("gate");
brightness = hslider("brightness[midi:ctrl 74]", 0.5, 0, 1, 0.01);

rhodes(f, g, gt) = body + bell with {
  modIdx = (0.5 + brightness * 3.0) * g;
  bodyEnv = en.adsr(0.001, 0.8, 0.6, 0.3, gt);
  bellEnv = en.adsr(0.001, 0.15, 0.0, 0.1, gt);
  bodyMod = os.osc(f) * modIdx * f;
  body = os.osc(f + bodyMod) * bodyEnv * 0.7;
  bellMod = os.osc(f*14) * modIdx * 0.5 * f;
  bell = os.osc(f*14 + bellMod) * bellEnv * 0.3;
};
process = rhodes(freq, gain, gate) <: _, _;
```

**Hammond B3 organ should absolutely be synthesized, not sampled.** The Hammond IS an additive synthesizer — sampling it is fundamentally redundant and loses the essential real-time drawbar control. Faust handles this naturally: 9 oscillators per note at fixed harmonic ratios (16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓', 1'), mixed according to drawbar levels 0–8. Essential character details include tonewheel leakage (adding ~−40 dB of adjacent wheel frequencies), key click (a 2–5ms filtered noise burst on key-on/off), and percussion (2nd or 3rd harmonic with fast single-trigger decay).

The Leslie speaker simulation is critical for organ authenticity. The architecture splits the signal at an 800 Hz Linkwitz-Riley crossover: treble feeds a horn model (time-varying delay lines for Doppler + AM modulation, rotating ~40 RPM slow / ~340 RPM fast), bass feeds a drum model (primarily AM + LP filtering variation). Spin-up/spin-down inertia (~1s acceleration, ~4s deceleration) creates the characteristic swooping Leslie sound. setBfree (GPL-2.0) provides an excellent reference implementation, though its code can't be directly used — a clean-room Faust reimplementation using the same well-documented DSP principles is the correct approach.

**Logic Pro's Vintage B3** uses component-level modeling with adjustable organ "condition" (wear, leakage, scratchiness). Faust can match this fully since the underlying algorithms are straightforward additive synthesis with character modeling. This is one category where free alternatives can achieve **95%+ of Logic Pro quality**.

---

## Orchestral instruments: the biggest quality gap

This is where free resources fall furthest short of Logic Pro, but a usable foundation exists.

**VSCO 2 Community Edition (CC0)** is the cornerstone — the only comprehensive orchestral library safe for commercial bundling. At **~2.3 GB** in SFZ format, it provides chamber-scale sections: violin section, viola section, cello section, solo contrabass, solo violin, and harp for strings; solo trumpet (with straight and harmonic mutes), French horn, tenor trombone, tuba for brass; flute, oboe, English horn, clarinet, bassoon for woodwinds. Each instrument typically has **2 velocity layers** (piano/forte crossfaded via CC1 mod wheel) and **1–2 round-robins** on short articulations. Articulations include sustained, spiccato, pizzicato, and tremolo for strings; sustained, staccato, vibrato for brass/woodwinds.

**VCSL (CC0)** supplements VSCO 2 CE with additional instruments. **University of Iowa Musical Instrument Samples** ("without restrictions" — not formally CC0 but permissive) provides excellent anechoic solo recordings at 3 dynamic levels in 24-bit/96kHz, covering violin, viola, cello, double bass, full brass, and woodwinds. These require custom SFZ mapping but are high-quality source material.

**Virtual Playing Orchestra** cannot be bundled as-is due to mixed licenses (some components use Philharmonia samples which explicitly prohibit sampler-instrument redistribution). **Sonatina Symphonic Orchestra's** CC Sampling Plus 1.0 license is legally risky for commercial redistribution. Both are excluded.

The SFZ keyswitch structure for an orchestral string instrument uses `sw_last` to select articulations, CC1 crossfading for dynamics, and round-robin for short notes:

```sfz
<control>
label_cc1=Dynamics
set_cc1=80
default_path=Samples/Strings/Violin_Section/

<global>
sw_lokey=24 sw_hikey=27 sw_default=24
ampeg_release=0.3 amp_veltrack=0

// SUSTAIN (keyswitch C1=24) — CC1 crossfades pp/ff
<master> sw_last=24 sw_label=Sustain
<group> xfout_locc1=0 xfout_hicc1=127
<region> sample=VlnSec_Sus_pp_C3.wav lokey=48 hikey=50 pitch_keycenter=48
// ... more regions across range

<group> xfin_locc1=0 xfin_hicc1=127
<region> sample=VlnSec_Sus_ff_C3.wav lokey=48 hikey=50 pitch_keycenter=48

// STACCATO (keyswitch C#1=25) — round-robin
<master> sw_last=25 sw_label=Staccato amp_veltrack=100
<group> seq_length=2 seq_position=1
<region> sample=VlnSec_Stacc_rr1_C3.wav lokey=48 hikey=50 pitch_keycenter=48
<group> seq_length=2 seq_position=2
<region> sample=VlnSec_Stacc_rr2_C3.wav lokey=48 hikey=50 pitch_keycenter=48

// PIZZICATO (keyswitch D1=26) — round-robin
<master> sw_last=26 sw_label=Pizzicato amp_veltrack=100 ampeg_release=0.6
<group> seq_length=2 seq_position=1
<region> sample=VlnSec_Pizz_rr1_C3.wav lokey=48 hikey=50 pitch_keycenter=48
// ...

// TREMOLO (keyswitch D#1=27)
<master> sw_last=27 sw_label=Tremolo
// ... pp/ff crossfade structure same as sustain
```

For woodwinds, sfizz's `trigger=first` and `trigger=legato` enable algorithmic legato by adjusting the incoming note's attack and sample offset:

```sfz
// First-note trigger (normal attack)
<master> group=1 off_by=1 trigger=first
<region> sample=Flute_Sus_C4.wav lokey=60 hikey=62 pitch_keycenter=60

// Legato trigger (smooth transition, skip attack)
<master> group=1 off_by=1 trigger=legato
ampeg_attack=0.08 offset=2000
<region> sample=Flute_Sus_C4.wav lokey=60 hikey=62 pitch_keycenter=60
```

**The gap versus Logic Pro Studio Strings/Horns is enormous.** Logic's string sections use **14+12+10+8+6 players** (vs VSCO's ~4–6), **3–5 mic positions** (vs 1), **true legato interval sampling** (sampled note-to-note transitions), **4–8+ velocity layers** (vs 2), **4–8+ round-robins** (vs 1–2), and **15–20 articulations** including harmonics, col legno, sul ponticello, con sordino, and Bartók pizzicato. The single biggest missing feature is true legato — it transforms melodic realism and simply cannot be faked with the algorithmic approach. Free orchestral strings are adequate for sustained pads, simple slow parts, and background textures, but fall short for exposed melodic lines, fast passages, or professional orchestral mockups.

**Mitigation strategies:** Add convolution reverb to compensate for dry recordings. Use `pitch_random` and `volume_random` SFZ opcodes to reduce repetition artifacts. Use `lorand`/`hirand` for random round-robin selection alongside sequential. Build keyswitch instruments combining all available articulations per instrument for usability.

---

## Drums and percussion: surprisingly strong free options

Acoustic drums are the second-strongest category after synthesis, with multiple CC0 libraries rivaling commercial quality.

**Virtuosity Drums (CC0)** is the top recommendation: a contemporary jazz kit recorded across **6 mic positions** (kick, snare, overheads, mid ribbon, room, vintage) with up to **36 dynamic levels** for shells (continuous "wave" technique rather than discrete layers) and 4 velocity layers for cymbals. It includes multiple hi-hat gradations, snare buzz/roll/flam articulations, and Latin percussion. At **~1.5 GB** (FLAC), it's manageable for bundling. Available at the sfzinstruments GitHub organization.

**Naked Drums (CC-BY-4.0)** provides **10 round-robins** per instrument with up to 5 velocity layers and multi-mic recording — excellent for rock/metal. At 1.3 GB (FLAC), it offers the deepest round-robin count among free libraries. **DrumGizmo kits** (CC-BY-4.0) like CrocellKit provide 16-channel professional recordings. **Karoryfer's CC0 collection** adds variety: Big Rusty Drums (2.3 GB, oversized 1980s kit), Swirly Drums (1.6 GB, **the only CC0 brush kit**), Frankensnare (900 MB, extensive snare collection), and Gogodze Phu Vol II (133 MB, compact/lo-fi option).

The SFZ drum kit structure requires cymbal choke groups (`group`/`off_by`), hi-hat CC4 pedal control (`locc4`/`hicc4`), round-robin sequencing, and room mic blending via CC:

```sfz
<control>
label_cc4=Hi-Hat Pedal
label_cc20=Room Level
set_cc4=127 set_cc20=64
default_path=Samples/

// KICK — 4 velocity layers, 3 round-robins
<group> key=36 loop_mode=one_shot
<region> lovel=1 hivel=31 seq_length=3 seq_position=1 sample=kick_v1_rr1.wav
<region> lovel=1 hivel=31 seq_length=3 seq_position=2 sample=kick_v1_rr2.wav
<region> lovel=1 hivel=31 seq_length=3 seq_position=3 sample=kick_v1_rr3.wav
// ... more velocity layers ...

// HI-HAT — CC4 controlled openness
// Closed (CC4=96-127)
<group> key=42 loop_mode=one_shot group=1 off_by=1 locc4=96 hicc4=127
<region> lovel=1 hivel=63 sample=hh_closed_v1.wav
<region> lovel=64 hivel=127 sample=hh_closed_v2.wav

// Half-open (CC4=48-95)
<group> key=42 loop_mode=one_shot group=1 off_by=1 locc4=48 hicc4=95
<region> lovel=1 hivel=63 sample=hh_halfopen_v1.wav

// Open (CC4=0-47)
<group> key=46 loop_mode=one_shot group=1 off_by=1 locc4=0 hicc4=47
<region> lovel=1 hivel=63 sample=hh_open_v1.wav

// CRASH — choke group
<group> key=49 loop_mode=one_shot group=2 off_by=2
<region> lovel=1 hivel=63 sample=crash1_v1.wav
<region> lovel=64 hivel=127 sample=crash1_v2.wav
// Choke trigger
<group> key=48 loop_mode=one_shot group=2
<region> sample=crash1_choke.wav
```

**Electronic drums (808/909) should be entirely synthesized in Faust.** The TR-808 was fully analog — synthesis is the authentic approach. The Faust `synths.lib` provides drum primitives, and custom implementations are straightforward:

```faust
// 808 Kick: sine with exponential pitch sweep + saturation
kick808(pitch, click, decay, drive, gate) = out with {
    env = en.adsr(0.001, decay, 0.0, 0.05, gate);
    pitchEnv = en.adsr(0.005, click, 0.0, 0.05, gate);
    clean = env * os.osc((1 + pitchEnv * 4) * pitch);
    out = ma.tanh(clean * drive);
};

// 808 Snare: two pitched oscillators + filtered noise
snare808(tone, noiseLvl, decay, gate) = tonal + noisy with {
    env = en.adsr(0.001, decay, 0.0, 0.05, gate);
    noiseEnv = en.adsr(0.001, decay * 0.7, 0.0, 0.05, gate);
    tonal = env * (os.osc(180) * 0.7 + os.osc(330) * 0.3);
    noisy = noiseEnv * noiseLvl * (no.noise : fi.resonbp(tone, 2, 1));
};

// 808 Hi-hat: metallic square wave oscillators + bandpass
hat808(decay, gate) = out with {
    env = en.adsr(0.001, decay, 0.0, 0.02, gate);
    metal = (os.square(540) + os.square(800) + os.square(1040)) / 3;
    out = env * (metal : fi.resonbp(8000, 3, 1));
};
```

The TR-909 is trickier — it used 6-bit PCM samples for hi-hats and cymbals, making it a hybrid analog/digital instrument. A small set of CC0 metallic texture samples combined with synthesis handles this well.

**Gap vs Logic Pro Drum Kit Designer:** Logic offers 30+ kit variants with extensive velocity layers and integrated mixer. Free CC0 libraries provide ~6–8 distinct kits. The quality gap is moderate — Virtuosity Drums' 36 dynamic levels actually exceed many commercial libraries. The main gaps are brush/jazz kit variety (only Swirly Drums covers brushes), vintage-specific kits, and integrated per-drum processing UI.

---

## Analog synths and pads: where free resources match Logic Pro

This is the category where Faust meets or exceeds Logic Pro's Retro Synth on a purely technical basis, with zero sample storage required.

Faust provides **bandlimited oscillators** (DPW/PTR/PolyBLEP anti-aliased sawtooth, square, triangle, pulse with variable duty), **research-grade VA filter models** (Moog 4th-order TPT ladder with self-oscillation, diode ladder, Korg 35, Oberheim with internal soft-clipping, Sallen-Key), **ADAA antialiased saturators** for warm distortion, and a complete **DX7 emulation library** with all 32 algorithms. Every Retro Synth mode has a Faust equivalent: analog (subtractive synthesis), sync (hard-sync via `os.hs_phasor`), wavetable (`rdtable` + `os.phasor`), and FM (`sy.fm` + DX7 library). Faust goes beyond Retro Synth with physical modeling, wave digital filters, and Casio CZ phase-distortion oscillators.

A 303-style acid bass uses the diode ladder filter for its characteristic squelchy resonance:

```faust
declare name "AcidBass303";
declare options "[midi:on][nvoices:1]";
import("stdfaust.lib");
freq = hslider("freq", 200, 50, 1000, 0.01);
gain = hslider("gain", 0.5, 0, 1, 0.01);
gate = button("gate");
cutoff = hslider("cutoff[midi:ctrl 74]", 0.3, 0.01, 1, 0.001) : si.smoo;
resonance = hslider("resonance[midi:ctrl 71]", 8, 0.7, 20, 0.1) : si.smoo;
envmod = hslider("envmod[midi:ctrl 16]", 0.5, 0, 1, 0.01) : si.smoo;
decay = hslider("decay[midi:ctrl 75]", 0.15, 0.01, 1.0, 0.01);
slide = hslider("slide[midi:ctrl 5]", 0.06, 0.001, 0.5, 0.001);

sfreq = freq : si.smooth(ba.tau2pole(slide));
osc_out = os.sawtooth(sfreq);
accent_env = en.ar(0.003, decay, gate) * envmod;
filtered = osc_out : ve.diodeLadder(min(1.0, cutoff + accent_env), resonance);
amp_env = en.adsr(0.003, 0.2, 0.0, 0.05, gate) * gain;
process = filtered * amp_env <: _, _;
```

A Minimoog-style lead uses 3 detuned sawtooths through a self-oscillating Moog ladder:

```faust
declare options "[midi:on][nvoices:1]";
import("stdfaust.lib");
freq = hslider("freq", 440, 50, 2000, 0.01);
gain = hslider("gain", 0.5, 0, 1, 0.01);
gate = button("gate");
glide = hslider("glide[midi:ctrl 5]", 0.08, 0.001, 0.5, 0.001);
sfreq = freq : si.smooth(ba.tau2pole(glide));
detune = hslider("detune[midi:ctrl 20]", 0.1, 0, 1, 0.01);
spread = detune * 0.01;
osc_sum = (os.sawtooth(sfreq) +
           os.sawtooth(sfreq*(1+spread)) +
           os.sawtooth(sfreq*(1-spread*1.5))) / 3;
cutoff = hslider("cutoff[midi:ctrl 74]", 0.4, 0.01, 1.0, 0.001) : si.smoo;
reso = hslider("resonance[midi:ctrl 71]", 4, 0.707, 25, 0.1) : si.smoo;
fenv = en.adsr(0.01, 0.3, 0.4, 0.2, gate) * 0.3;
filtered = osc_sum : ve.moogLadder(min(1.0, cutoff + fenv), reso);
process = filtered * en.adsr(0.005, 0.2, 0.7, 0.3, gate) * gain <: _, _;
```

For lush pads, a supersaw architecture with 7 detuned oscillators, Oberheim filtering, and stereo chorus creates the characteristic warm wash. The `effect = _, _ : dm.zita_light;` declaration adds shared reverb across all polyphonic voices.

**Wavetable synthesis** works via `rdtable` — fill a table at init time, read it with a phasor, and crossfade between tables for morphing. Faust also supports hard-sync wavetables via `os.hs_phasor` for phase-reset effects.

**Quality assessment:** Faust's filter implementations are derived from the same reference material (Zavalishin, Pirkle, Smith) used by Native Instruments, u-he, and other commercial developers. The anti-aliased oscillators use peer-reviewed algorithms. When compiled to WASM via faust2wam, performance is roughly 1.5–2× slower than native C++ but sufficient for 8–12 polyphonic voices. **This category achieves 95–100% of Logic Pro Retro Synth quality.**

---

## Guitar and bass: honesty about what's achievable

Guitar is the hardest instrument to sample convincingly, and free resources narrow the achievable scope further. Bass, however, is well-served.

**For electric guitar**, Karoryfer Emilyguitar (CC0, Epiphone SG-style, DI recording) provides **4 velocity layers and 3 round-robins** with string release noises and percussive fingering noises at ~99 MB. Karoryfer Shinyguitar (CC0, semiacoustic archtop, 351 MB) covers jazz/blues/ambient acoustic-ish tones. Both are DI recordings requiring amp simulation.

Guitar amp modeling in Faust is well-established — waveshaping (`ma.tanh` or `aa.tanh1` for ADAA antialiased saturation) for tube stages, parametric IIR filters for tone stacks (Yeh & Smith's digitized Fender Bassman method), and cabinet simulation via IIR filter cascades (since free cabinet IRs generally lack redistribution licenses, synthetic cab modeling via biquad chains is the safe approach).

**What works with free guitar samples:** Single-note melodies, arpeggiated patterns, ambient textures, palm-muted power chord patterns, basic fingerpicking. **What does not work:** Realistic chord strumming (the temporal offset between strings, sympathetic resonance, and voicing complexity are impossible with note-by-note sampling), legato slides/hammer-ons/pull-offs, bending, and string noise that reacts contextually. Label the instrument "Guitar" not "Realistic Guitar" — users will understand the limitation.

**Bass guitar is genuinely strong.** Karoryfer Growlybass (CC0, Squier Jazz, **4 velocity layers, 4 round-robins**, staccato, pick scrapes, 159 MB) is the primary choice. Karoryfer Black And Blue Basses (CC0, two 5-string basses, newer) and Fashionbass (CC0, R&B/hip-hop) provide variety. FreePats Electric Bass YR (CC0, Yamaha RBX) adds a basic option. Physical modeling via Faust's Karplus-Strong (`pm.ks`) also works well for bass — lower frequencies and simpler spectral content make waveguide models more accurate than for guitar. **The main gap is slap bass**, which no CC0 library covers.

**Faust plucked-string physical model:**

```faust
import("stdfaust.lib");
freq = hslider("freq", 110, 30, 500, 0.01);
gate = button("gate");
gain = hslider("gain", 0.8, 0, 1, 0.01);
pluckPos = hslider("pluck", 0.3, 0.05, 0.95, 0.01);
brightness = hslider("bright", 0.5, 0, 1, 0.01);
stringLen = pm.f2l(freq);
excitation = pm.impulseExcitation(gate) * gain;
process = pm.ks(stringLen, pluckPos, excitation)
        : fi.lowpass(2, 800 + brightness * 8000) <: _, _;
```

---

## Mellotron and vintage tape: a creative workaround needed

**No CC0 Mellotron sample library exists.** This is a critical finding. Every free Mellotron sample set traces back to Taijiguy/Leisureland's collection, which explicitly states "you MAY NOT sell the samples and you may not repackage the samples in a different format and sell that." The Mellotron Archive has no explicit open license. Plogue Sforzatron's SFZ mappings are CC0 but the underlying samples retain the restriction.

**The recommended workaround: VCSL CC0 orchestral samples + Faust tape processing.** Use clean CC0 flute, strings, brass, and choir-like sounds from VCSL, then process through a Faust tape effect chain that adds Mellotron character:

```faust
import("stdfaust.lib");
tape_age = hslider("Tape Age", 0.5, 0.0, 1.0, 0.01);
wow = os.osc(hslider("Wow Rate", 0.5, 0.1, 2, 0.01))
    * hslider("Wow Depth", 0.3, 0, 1, 0.01) * 100;
flutter = (os.osc(12) + no.noise * 0.002) * 0.1 * 20;
saturator(x) = x <: _, _ : (ma.tanh, _)
             : si.interpolate(hslider("Saturation", 0.3, 0, 1, 0.01));
tapeEQ = fi.lowpass(2, 6000 - tape_age * 3000);
hiss = no.noise : fi.bandpass(2, 1000, 8000) * 0.02 * (1 + tape_age);
process = de.fdelay(ma.SR, 100 + wow + flutter) : saturator : tapeEQ, hiss :> _;
```

The SFZ mapping for authentic Mellotron behavior uses `amp_veltrack=0` (no velocity sensitivity), `pitch_random=5` (tape pitch drift), `loop_mode=one_shot` with samples truncated at ~8 seconds (tape strip length), and a slight attack delay (`ampeg_attack=0.02`) for tape engagement. This approach creates an original instrument — not a derivative of any restricted library — while achieving the essential Mellotron aesthetic.

For Chamberlin and Optigan: no CC0 samples exist for either. These are extremely niche and likely not worth pursuing.

---

## Choir and vocal textures: the weakest category

**No CC0 SATB choir library exists anywhere.** This is the single biggest gap in the entire free sample ecosystem. VSCO 2 CE does not include choir (it's only in the $229 Professional Edition). Pianobook and LABS choir libraries are proprietary. The only CC0 vocal content found was Karoryfer's "272 Merry Orks" — female death metal screams, unsuitable for traditional choir.

**Faust formant synthesis is the only viable path.** The `physmodels.lib` provides source-filter vocal models with FOF (Forme d'Onde Formantique) synthesis and bandpass formant banks. The `pm.SFFormantModelBP` function takes voice type (soprano through bass), vowel (a/e/i/o/u with fractional interpolation for morphing), frequency, and gain — producing smooth vowel transitions via linear interpolation of formant parameters:

```faust
import("stdfaust.lib");
freq = hslider("freq", 220, 80, 800, 0.01);
gate = button("gate");
gain = hslider("gain", 0.7, 0, 1, 0.01);
voiceType = hslider("voice", 3, 0, 4, 1); // 0=sop 1=alto 2=ctnr 3=ten 4=bass
vowel = hslider("vowel[midi:ctrl 1]", 3, 0, 4, 0.01); // CC1 morphs vowels
source = os.lf_imptrain(freq) * gate * gain;
process = pm.SFFormantModelBP(voiceType, vowel, 0.2, freq, gain, source,
          pm.formantFilterbankBP, 0) <: _, _;
```

This produces convincing **"ooh/aah" pad textures** and ethereal vocal-like sounds. It does not sound like a real human choir — no vibrato variation between singers, no consonants, no breathing, no ensemble spread. Label it "Vocal Pad" or "Synth Choir," not "Choir."

**Recommendation:** Ship Faust vocal synthesis as a "Vocal Pad" instrument with vowel morphing via mod wheel. Layer with cathedral convolution reverb for spatial depth. Consider commissioning CC0 choir recordings as a future project (even 4 singers × 5 vowels × chromatic = ~300 samples would be transformative).

---

## Sample library packaging and delivery strategy

Professional DAWs handle large content libraries through tiered delivery. Logic Pro's full library is **~72 GB** split into 900+ individually downloadable packages, with ~2 GB of essential content in the initial install. This pattern should inform the free instrument suite's delivery.

**Recommended tiers for a Tauri-based DAW:**

- **Bundled with installer (~100–200 MB):** Faust synthesis instruments (analog synth, organ, 808 drums, pads, vocal pad — zero sample cost), Splendid Grand Piano (77 MB FLAC), Gogodze Phu drum kit (133 MB), FreePats Electric Bass YR (small)
- **First-run download (~1–2 GB):** Salamander Grand Piano (707 MB FLAC), Virtuosity Drums (1.5 GB), VSCO 2 CE core strings/woodwinds (~500 MB compressed)
- **On-demand download (~3–5 GB):** Full VSCO 2 CE orchestral suite, Naked Drums, Karoryfer guitar/bass collection, Sofia MZ piano upgrade
- **Optional premium download (~4+ GB):** Sofia MZ Steinway D, additional Karoryfer drum kits

**Compression strategy:** Distribute as FLAC (50–60% smaller than WAV). Decode to PCM at load time using Rust/symphonia in the Tauri backend, then transfer to WASM virtual filesystem. For the Tauri architecture specifically:

1. Tauri command `load_instrument(path)` triggers Rust to read the SFZ file and identify needed samples
2. Rust background thread decodes FLAC files via symphonia
3. Decoded PCM buffers transfer to the frontend via Tauri's `invoke()` as ArrayBuffers
4. Frontend writes buffers into Emscripten's virtual filesystem, then calls sfizz's `loadSfzFile()`
5. Progressive loading: decode first few KB of each sample first (matching sfizz's preload concept), send the rest in background

Target **≤1 GB uncompressed sample data per loaded instrument** for WASM memory safety. Use instrument-level lazy loading — only the currently selected instrument's samples reside in memory.

---

## Honest priority ranking and what to build first

The synthesis-first strategy delivers the highest quality-to-effort ratio. Here is the recommended build order ranked by achievable quality relative to Logic Pro:

**Phase 1 — Ship-ready instruments (95%+ Logic Pro quality):**
Analog/subtractive synth via Faust (Moog, 303, Juno, Prophet-5 presets). Hammond B3 organ via Faust tonewheel synthesis + Leslie effect. 808/909 drum machine via Faust synthesis. Pad/texture synthesizer via Faust (supersaw, wavetable, filtered noise). FM synthesizer via Faust DX7 library. These require **zero sample storage** and match or exceed Logic Pro's equivalents.

**Phase 2 — Strong free resources (75–85% Logic Pro quality):**
Acoustic piano (Salamander Grand, 16 velocity layers). Acoustic drum kits (Virtuosity Drums CC0 + Naked Drums CC-BY). Bass guitar (Karoryfer Growlybass CC0). Electric piano (Faust FM synthesis). Vocal pad (Faust formant synthesis).

**Phase 3 — Significant quality gap but usable (50–65% Logic Pro quality):**
Orchestral strings (VSCO 2 CE, 2 velocity layers, limited articulations). Brass and woodwinds (VSCO 2 CE + Iowa). Guitar (Karoryfer Emilyguitar + Faust amp sim). Mellotron (VCSL CC0 samples + Faust tape processing).

**Phase 4 — Future investment needed:**
Commission CC0 choir recordings. Record additional CC0 orchestral samples with more velocity layers. True legato interval sampling for strings/winds. Premium piano with multiple mic positions.

---

## Complete library reference with verified licenses

| Library                       | License                | Category        | Size          | Key specs                     |
| ----------------------------- | ---------------------- | --------------- | ------------- | ----------------------------- |
| Salamander Grand Piano        | CC-BY-3.0              | Piano           | 707 MB (FLAC) | 16 vel layers, Yamaha C5      |
| Sofia MZ Pianos               | CC-BY                  | Piano           | 4.3 GB each   | 20 vel layers, pedal samples  |
| Splendid Grand Piano          | Public Domain          | Piano           | 77 MB (FLAC)  | 4 vel layers, Steinway        |
| FreePats Upright KW           | CC0                    | Piano           | 32 MB         | 2 vel layers, Kawai upright   |
| VSCO 2 Community Edition      | CC0                    | Orchestra       | ~2.3 GB       | 2 vel, 1–2 RR, full orchestra |
| VCSL                          | CC0                    | Multi           | Varies        | Broader coverage than VSCO    |
| Iowa MIS                      | "Without restrictions" | Orchestra/Solo  | Varies        | 3 dynamics, 24-bit/96kHz      |
| Virtuosity Drums              | CC0                    | Drums           | ~1.5 GB       | 36 dynamics, 6 mics, jazz kit |
| Naked Drums                   | CC-BY-4.0              | Drums           | 1.3 GB        | 10 RR, 5 vel, multi-mic       |
| DrumGizmo CrocellKit          | CC-BY-4.0              | Drums           | 5.5 GB        | 16 mic channels, rock/metal   |
| Salamander Drumkit            | CC-BY-SA-3.0           | Drums           | 370 MB        | CC4 hi-hat, SFZ mapped        |
| Swirly Drums                  | CC0                    | Drums           | 1.6 GB        | **Only CC0 brush kit**        |
| Karoryfer Emilyguitar         | CC0                    | Electric guitar | 99 MB         | 4 vel, 3 RR, DI recording     |
| Karoryfer Shinyguitar         | CC0                    | Acoustic guitar | 351 MB        | Semiacoustic archtop          |
| Karoryfer Growlybass          | CC0                    | Bass            | 159 MB        | 4 vel, 4 RR, Jazz bass        |
| Karoryfer Black & Blue Basses | CC0                    | Bass            | ~500 MB       | Two 5-string basses           |
| Karoryfer Fashionbass         | CC0                    | Bass            | ~200 MB       | R&B/hip-hop tone              |
| FreePats Electric Bass YR     | CC0                    | Bass            | Small         | Yamaha RBX, fingered          |

**Sources to avoid:** Maestro Concert Grand (CC Sampling Plus 1.0 — restricted), Virtual Playing Orchestra as-is (mixed licenses including Philharmonia prohibition), Sonatina Symphonic Orchestra (CC Sampling Plus — ambiguous), Taijiguy Mellotron samples (explicit no-repackaging clause), MT Power Drum Kit (proprietary freeware), Keyzone Classic (proprietary), Ample Bass Lite (proprietary EULA), Pianobook libraries (most prohibit redistribution), Spitfire LABS (proprietary), BBCSO Discover (proprietary).

---

## What this suite achieves — and where it falls short

Built correctly, this instrument suite delivers a **genuinely impressive first impression** for synthesis-based instruments. The analog synths, organ, 808 drum machine, and pad/texture instruments can produce sounds that rival commercial DAW plugins — the underlying DSP algorithms are identical to those used in high-end commercial software. The piano and acoustic drum kits are professional-quality, with Virtuosity Drums' 36 dynamic levels actually exceeding many commercial libraries.

The honest shortfalls are in orchestral instruments (limited velocity layers, no true legato, single mic position), choir (synthesis-only, no sample-based option), guitar strumming (fundamentally impossible with note-by-note sampling), and Mellotron (requires the creative workaround of tape-processing clean CC0 samples). These gaps are structural — they reflect the cost of professional sample recording, which runs tens of thousands of dollars per instrument. Logic Pro's ~72 GB library represents millions of dollars in recording investment amortized across millions of users.

The strategic insight is that **synthesis closes most of the \"wow factor\" gap.** A well-programmed Faust Moog lead, a realistic tonewheel organ with Leslie, a punchy 808 kit, and a lush supersaw pad create the emotional impact that makes users feel they're working with a professional tool. The sampled instruments fill in what synthesis cannot — and at the CC0/CC-BY tier, they do so adequately for most production contexts outside exposed orchestral writing.

---

## See Also

- **[faust-wam-plugins SKILL.md](./.agents/skills/faust-wam-plugins/SKILL.md)** — Authoritative rules for agents building Faust/WAM/SFZ instruments: hosting lifecycle, WAM SDK, sfizz opcodes, license matrix
- **[plugins.md](./plugins.md)** — WAM 2.0 plugin suite architecture and the Faust→WAM compilation pipeline
