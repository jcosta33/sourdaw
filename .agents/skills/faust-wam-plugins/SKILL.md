---
name: faust-wam-plugins
description: Apply when building built-in DAW plugins using Faust DSP or WAM 2.0, authoring SFZ instruments for sfizz WASM, selecting free sample libraries for commercial bundling, or managing the WAM plugin hosting lifecycle in AudioWorklet. Apply even when the user says "built-in plugin", "Faust", "WAM", "SFZ", "sfizz", "instrument", "sample library", "plugin suite", "WASM DSP", or "faust2wam".
---

# Faust + WAM Plugins Skill

## Architecture: All Built-in Plugins Are WAM 2.0

Every built-in plugin should be a **WAM (Web Audio Module) 2.0 plugin** compiled from Faust DSP, bundled locally. This eliminates dual maintenance of internal vs. external formats and gives every plugin standardized parameter automation, MIDI, and state save/restore for free.

```
Faust DSP source (.dsp)
    ↓ faust2wam
WAM 2.0 plugin (WASM + AudioWorklet processor + TypeScript descriptor)
    ↓ bundled locally (not loaded from URL)
AudioContext graph
```

## WAM 2.0 Cross-Platform Compatibility

| API | WKWebView | WebView2 | WebKitGTK (Linux) |
|---|---|---|---|
| AudioWorklet | ✅ Safari 14.1+ | ✅ | ✅ WebKitGTK 2.36+ |
| SharedArrayBuffer | ✅ Safari 15.2+ (COOP/COEP) | ✅ | ⚠️ WebKitGTK 2.40+ required |
| WebAssembly | ✅ | ✅ | ✅ |
| WASM SIMD | ✅ Safari 16.4+ | ✅ | ⚠️ Version-dependent |

**Required Tauri config** for SharedArrayBuffer (WAM's fast path):

```json
// tauri.conf.json — production
{
  "app": {
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src ipc: http://ipc.localhost",
      "headers": {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp"
      }
    }
  }
}
```

```typescript
// vite.config.ts — dev server must mirror production headers
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  },
},
```

Check at runtime: `window.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'`. WAM degrades to MessagePort communication without SAB (higher parameter automation latency but functional).

## WAM Hosting in Code

```typescript
import { addFunctionModule, initializeWamEnv, initializeWamGroup } from '@webaudiomodules/sdk';
import { VERSION } from '@webaudiomodules/api';

// 1. Initialize WAM environment once per AudioContext
await addFunctionModule(audioContext.audioWorklet, initializeWamEnv, VERSION);

// 2. Create host group (all plugins in group share MIDI/automation bus)
const hostGroupId = 'daw-host';
const hostGroupKey = crypto.randomUUID();
await addFunctionModule(audioContext.audioWorklet, initializeWamGroup, hostGroupId, hostGroupKey);

// 3. Load built-in plugin — same API as remote WAM plugins
const { default: PluginCtor } = await import('./plugins/eq/index.js');
const plugin = await PluginCtor.createInstance(audioContext, {});

// 4. Connect to audio graph
sourceNode.connect(plugin.audioNode);
plugin.audioNode.connect(audioContext.destination);

// 5. Parameter automation (sample-accurate)
plugin.audioNode.scheduleEvents({
  type: 'wam-automation',
  data: { id: 'gain', value: 0.8, normalized: false },
  time: audioContext.currentTime + 1.0,
});

// 6. State save/restore
const state = await plugin.audioNode.getState();
await plugin.audioNode.setState(state);
```

### Built-in Plugin Registry

```typescript
const BUILTIN_PLUGINS: Record<string, () => Promise<any>> = {
  'com.webdaw.eq':         () => import('./plugins/eq/index.js'),
  'com.webdaw.compressor': () => import('./plugins/compressor/index.js'),
  'com.webdaw.reverb':     () => import('./plugins/reverb/index.js'),
  'com.webdaw.synth-sub':  () => import('./plugins/synth-sub/index.js'),
};

async function loadPlugin(id: string, ctx: AudioContext) {
  const builtin = BUILTIN_PLUGINS[id];
  if (builtin) {
    const { default: Ctor } = await builtin();
    return Ctor.createInstance(ctx, {});
  }
  // Third-party: load from URL (validate before executing)
  const { default: Ctor } = await import(/* @vite-ignore */ thirdPartyUrl);
  return Ctor.createInstance(ctx, {});
}
```

## Faust DSP Patterns

### Polyphonic MIDI Instrument

```faust
declare options "[midi:on][nvoices:12]";
import("stdfaust.lib");

freq  = hslider("freq",  440,  50, 2000, 0.01);
gain  = hslider("gain",  0.5,   0,    1, 0.01);
gate  = button("gate");

// Rhodes-style FM electric piano
rhodes(f, g, gt) = body + bell with {
  modIdx  = (0.5 + 3.0 * g);
  bodyEnv = en.adsr(0.001, 0.8, 0.6, 0.3, gt);
  bellEnv = en.adsr(0.001, 0.15, 0.0, 0.1, gt);
  bodyMod = os.osc(f) * modIdx * f;
  body    = os.osc(f + bodyMod) * bodyEnv * 0.7;
  bellMod = os.osc(f*14) * modIdx * 0.5 * f;
  bell    = os.osc(f*14 + bellMod) * bellEnv * 0.3;
};
process = rhodes(freq, gain, gate) <: _, _;
```

### Hammond B3 Organ (Additive — Do Not Sample)

The Hammond IS an additive synthesizer — sample it never. Faust handles this naturally: 9 oscillators per note at fixed harmonic ratios (16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓', 1'), mixed per drawbar position. Add:
- **Tonewheel leakage**: ~−40 dB of adjacent wheel frequencies
- **Key click**: 2–5ms filtered noise burst on key-on/off
- **Percussion**: 2nd/3rd harmonic, fast single-trigger decay
- **Leslie simulation**: Linkwitz-Riley crossover at 800 Hz, treble horn (Doppler + AM modulation), bass drum (AM + LP filtering variation), spin-up/down inertia

### VA Filters Available in Faust

Available via `fi.` library (Zavalishin's _Art of VA Filter Design_):
- `fi.moog_vcf(res, fr)` — Moog ladder, self-oscillates at res≥25
- `fi.diode` — Diode ladder (softer character)
- `fi.korg35_lpf` — Korg 35 / MS-20
- `fi.oberheim_hpf` — Oberheim with internal soft-clip

All are TPT (Topology-Preserving Transform) — sample-rate-agnostic and stable.

## SFZ Instrument Authoring (sfizz WASM)

sfizz WASM supports **96% of SFZ v1** and 44% of SFZ v2. Critical professional opcodes all work:
- `seq_length` / `seq_position` — round-robin
- `sw_last` / `sw_lokey` / `sw_hikey` / `sw_default` — keyswitches
- `xfin_locc1` / `xfin_hicc1` / `xfout_locc1` / `xfout_hicc1` — CC crossfading
- `group` / `off_by` / `off_mode` — choke groups
- `trigger=release` / `trigger=first` / `trigger=legato` — advanced triggers
- Full DAHDSR envelopes, flex EGs, filters, loop controls

**Memory constraint**: All samples must fit in memory (~1.5–2.5 GB decoded PCM limit in browser). FLAC saves download bandwidth but not runtime memory. Use Tauri/Rust to pre-decode FLAC via `symphonia` and transfer PCM to sfizz's virtual FS via IPC for large instruments.

### Professional SFZ Structure

```sfz
<control>
default_path=samples/

<global>
ampeg_release=0.8
amp_veltrack=80

// Attack layers (show 2 of 16 velocity layers)
<group> trigger=attack hicc64=63
<region> sample=C4_v01.flac lokey=59 hikey=63 pitch_keycenter=60 lovel=1 hivel=8
<region> sample=C4_v02.flac lokey=59 hikey=63 pitch_keycenter=60 lovel=9 hivel=16
// ... layers 3–16 ...

// Release samples (damper return)
<group> trigger=release rt_decay=6 note_polyphony=1
ampeg_attack=0.01 ampeg_decay=0.5 ampeg_sustain=0
<region> sample=C4_rel.flac lokey=59 hikey=63 pitch_keycenter=60

// Pedal noise (CC64)
<group> on_locc64=100 on_hicc64=127 loop_mode=one_shot
<region> sample=pedal_down_1.flac key=0

// Sympathetic resonance
<group> trigger=release locc64=64 volume=-12
ampeg_attack=0.1 ampeg_release=3.0 note_polyphony=1
<region> sample=C4_resonance.flac lokey=59 hikey=63 pitch_keycenter=60
```

### Orchestral Keyswitch Template

```sfz
<global>
sw_lokey=24 sw_hikey=27 sw_default=24
amp_veltrack=0

// SUSTAIN (C1) — CC1 crossfade pp/ff
<master> sw_last=24 sw_label=Sustain
<group> xfout_locc1=0 xfout_hicc1=127
<region> sample=VlnSec_Sus_pp_C3.wav lokey=48 hikey=50 pitch_keycenter=48
<group> xfin_locc1=0 xfin_hicc1=127
<region> sample=VlnSec_Sus_ff_C3.wav lokey=48 hikey=50 pitch_keycenter=48

// STACCATO (C#1) — round-robin
<master> sw_last=25 sw_label=Staccato amp_veltrack=100
<group> seq_length=2 seq_position=1
<region> sample=VlnSec_Stacc_rr1_C3.wav lokey=48 hikey=50 pitch_keycenter=48
<group> seq_length=2 seq_position=2
<region> sample=VlnSec_Stacc_rr2_C3.wav lokey=48 hikey=50 pitch_keycenter=48
```

### Legato Trigger for Woodwinds

```sfz
// First-note trigger (normal attack)
<master> group=1 off_by=1 trigger=first
<region> sample=Flute_Sus_C4.wav lokey=60 hikey=62 pitch_keycenter=60

// Legato trigger (smooth transition, skip attack phase)
<master> group=1 off_by=1 trigger=legato
ampeg_attack=0.08 offset=2000
<region> sample=Flute_Sus_C4.wav lokey=60 hikey=62 pitch_keycenter=60
```

## Sample Library License Matrix

Only these libraries are safe for commercial bundling:

| Library | License | Quality | Notes |
|---|---|---|---|
| **Salamander Grand Piano** | CC-BY-3.0 | Good (16 vel layers) | Attribution required |
| **Sofia MZ Pianos** | CC-BY | Excellent (20 vel layers) | 4.3 GB per piano |
| **Virtuosity Drums** | CC0 | Excellent (36 dyn levels, 6 mics) | Commercial use unrestricted |
| **Naked Drums** | CC-BY-4.0 | Very good (10 round-robins) | Attribution required |
| **VSCO 2 Community Edition** | CC0 | Adequate (2 vel layers) | Only safe orchestral option |
| **Karoryfer CC0 Collection** | CC0 | Varied | Big Rusty, Swirly, Frankensnare |

**Do NOT bundle (license violations):**
- `jRhodes3` (CC-BY-NC: no commercial use)
- `pitchfinder` npm package (GPL-v3: copyleft)
- Essentia.js (AGPL-3.0: must open-source or buy commercial license)
- Virtual Playing Orchestra (mixed licenses — Philharmonia prohibits redistribution)
- Sonatina Symphonic Orchestra (CC Sampling Plus 1.0 — legally risky)

**For electric piano**: No CC0 Rhodes samples exist. Use Faust FM synthesis instead (2-carrier FM, velocity-controlled modulation index) — the DX7's E.Piano 1 approach is sonically correct.

**For organs**: Never sample; always synthesize with additive synthesis via Faust.

## Licensing Summary for Faust Output

Faust's LGPL-with-exception license **explicitly permits commercial distribution of compiled output** (WASM binaries). You do not need to open-source plugin binaries compiled from Faust source.

## See Also

- `.agents/plugins.md` — full WAM hosting guide with Faust plugin catalog
- `.agents/instruments.md` — instrument-by-instrument quality assessment vs Logic Pro
