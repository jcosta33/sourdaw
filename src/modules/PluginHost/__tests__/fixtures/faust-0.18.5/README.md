# Frozen Faust sound expectations

These samples were captured with the shipped FaustWasm 0.18.5 wrapper and public libfaust 2.89.2
assets, before the dependency upgrade. `manifest.json` records the retained production revision,
the committed capture code revision, source and runtime byte hashes, embedded library hashes,
actual compiled UI addresses/defaults, applied controls, input hashes, exact MIDI event frames,
sample rates, block sizes, output and meter stream lengths, PCM hashes, and observed onset/energy.
Every case was rendered twice with independent DSP instances and required byte-identical PCM.

The `.f32.gz` files contain ordinary gzip over planar little-endian float32 samples. The manifest's
stream list supplies each plane's length: both audio outputs first, then any meter sampled once per
block. No quantization, resampling, trimming, phase alignment or onset alignment is performed.
The normal maintained spec reads these files and never writes expectations. Capture mode refuses
an existing fixture directory and verifies exact old asset, wrapper and compiler identities before
writing; it cannot regenerate these expectations under a new compiler. Never bless a new output,
replace these samples, weaken their tolerance, or update on failure to make an upgrade pass.

The matrix covers every source registered by builtin and Synth registration at capture. Defaults
run at 48 kHz in 128-frame blocks. Additional cases discriminate EQ Q=1/Q=10, all FM algorithms,
the four morph waveform endpoints, filter corners, envelope release/retrigger, fractional string
delay, meter outputs, unequal stereo channels, limiter latency, and wet reverb/delay behavior at
44.1/96/192 kHz. Two cases also use 512-frame blocks. The retained tail windows are explicit bounded
observations, not a claim that every reverb's physical decay has finished. The cases are not a
Cartesian sweep of every parameter, rate and block size.

Instrument PCM uses the production effect-free poly factory and eight actual vendor voices.
The public mono/poly DSP's timed `compute` API applies sub-block events at their integer frames.
This does not exercise the production scheduler, OfflineProcessor, AudioWorklet construction,
UI, a physical audio device, or saved-project replay. The channel-5 Rhodes case records matching
nonzero-channel keyOn/keyOff; the old wrapper releases by pitch globally, so this case does not
claim channel isolation. That separate wrapper change needs a production caller regression test.

Audio comparison ceilings are maximum absolute error `1e-5` (-100 dBFS) and RMS error `1e-6`
(-120 dBFS), with identical channel/frame shape and no non-finite samples. Meter planes use the
same small numeric ceilings in their own units. The spec also perturbs a copy of actual frozen PCM
and rejects that drift, non-finite samples and truncation. These bounds admit small arithmetic
rounding only; an audible, phase, onset, envelope or gain change must be investigated and repaired.
