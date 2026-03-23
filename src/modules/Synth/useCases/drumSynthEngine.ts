/**
 * Dedicated drum synthesis engine.
 * Each voice type has its own audio graph topology modelling real analog drum machines.
 *
 * 808 Kick:   Sine osc with rapid pitch sweep + body resonance
 * 808 Snare:  Noise burst + sine body tone
 * 808 Clap:   Filtered noise with multi-tap echo
 * 808 HH:     6 detuned square oscillators (metallic) + highpass noise
 * 808 Tom:    Sine with pitch sweep (less extreme than kick)
 * 808 Cowbell: Two detuned square oscillators + bandpass
 * 808 Rimshot: Short noise + high sine click
 * 808 Conga:  Sine with moderate pitch sweep
 */

// ── Voice type identifiers ──────────────────────────────────────────────────
export type DrumVoiceType =
    | 'kick'
    | 'snare'
    | 'clap'
    | 'closed-hh'
    | 'open-hh'
    | 'tom-low'
    | 'tom-mid'
    | 'tom-high'
    | 'cowbell'
    | 'rimshot'
    | 'conga-low'
    | 'conga-mid'
    | 'conga-high'
    | 'maracas'
    | 'clave';

export type DrumVoiceDef = {
    name: string;
    midiNote: number;
    type: DrumVoiceType;
};

export type DrumKitDef = {
    id: string;
    name: string;
    voices: DrumVoiceDef[];
};

// ── Helper: create noise buffer ─────────────────────────────────────────────
function createNoiseBuffer(ctx: BaseAudioContext, durationSec: number): AudioBuffer {
    const length = Math.ceil(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    return buffer;
}

// ── 808 Kick ────────────────────────────────────────────────────────────────
// Deep sine wave with rapid pitch sweep from ~150Hz → ~50Hz, long decay
function schedule808Kick(
    ctx: BaseAudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number
): void {
    const vel = velocity / 127;
    const osc = ctx.createOscillator();
    osc.type = 'sine';

    // Pitch sweep: start high, drop quickly to fundamental
    osc.frequency.setValueAtTime(150, startTime);
    osc.frequency.exponentialRampToValueAtTime(50, startTime + 0.04);
    osc.frequency.exponentialRampToValueAtTime(30, startTime + 0.5);

    // Amplitude envelope
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 1.2, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.8);

    // Slight distortion via waveshaper for warmth
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
        const x = (i / 128) - 1;
        curve[i] = (Math.PI + 3) * x / (Math.PI + 3 * Math.abs(x));
    }
    shaper.curve = curve;
    shaper.oversample = '2x';

    osc.connect(shaper);
    shaper.connect(gain);
    gain.connect(dest);

    osc.start(startTime);
    osc.stop(startTime + 0.9);
}

// ── 808 Snare ───────────────────────────────────────────────────────────────
// Noise burst (snare wires) + tuned sine body
function schedule808Snare(
    ctx: BaseAudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number
): void {
    const vel = velocity / 127;

    // -- Body tone (sine) --
    const bodyOsc = ctx.createOscillator();
    bodyOsc.type = 'triangle';
    bodyOsc.frequency.setValueAtTime(180, startTime);
    bodyOsc.frequency.exponentialRampToValueAtTime(120, startTime + 0.05);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(vel * 0.7, startTime);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.15);

    bodyOsc.connect(bodyGain);
    bodyGain.connect(dest);
    bodyOsc.start(startTime);
    bodyOsc.stop(startTime + 0.2);

    // -- Noise layer (snare wires) --
    const noiseBuffer = createNoiseBuffer(ctx, 0.3);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 2000;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(vel * 0.8, startTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(dest);
    noise.start(startTime);
    noise.stop(startTime + 0.3);
}

// ── 808 Clap ────────────────────────────────────────────────────────────────
// Multiple rapid noise bursts simulating hands clapping
function schedule808Clap(
    ctx: BaseAudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number
): void {
    const vel = velocity / 127;
    const noiseBuffer = createNoiseBuffer(ctx, 0.4);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2500;
    filter.Q.value = 3;

    // 3 quick bursts followed by a longer tail
    const burstTimes = [0, 0.015, 0.03];
    for (const offset of burstTimes) {
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, startTime + offset);
        env.gain.linearRampToValueAtTime(vel * 0.6, startTime + offset + 0.001);
        env.gain.exponentialRampToValueAtTime(0.001, startTime + offset + 0.02);
        noise.connect(env);
        env.connect(filter);
        noise.start(startTime + offset);
        noise.stop(startTime + offset + 0.03);
    }

    // Tail
    const tailNoise = ctx.createBufferSource();
    tailNoise.buffer = noiseBuffer;
    const tailEnv = ctx.createGain();
    tailEnv.gain.setValueAtTime(vel * 0.5, startTime + 0.04);
    tailEnv.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);
    tailNoise.connect(tailEnv);
    tailEnv.connect(filter);
    tailNoise.start(startTime + 0.04);
    tailNoise.stop(startTime + 0.35);

    filter.connect(dest);
}

// ── 808 Hi-Hat (closed + open) ──────────────────────────────────────────────
// 6 detuned square oscillators at non-harmonic ratios create metallic timbre
function schedule808HiHat(
    ctx: BaseAudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number,
    isOpen: boolean
): void {
    const vel = velocity / 127;
    const decayTime = isOpen ? 0.4 : 0.06;

    // Metallic tone: 6 square oscillators at non-harmonic frequencies
    const fundamentals = [800, 1046.5, 1318.5, 1480, 1661.2, 1864.7];
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(vel * 0.25, startTime);
    oscGain.gain.exponentialRampToValueAtTime(0.001, startTime + decayTime);

    for (const freq of fundamentals) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = freq;
        osc.connect(oscGain);
        osc.start(startTime);
        osc.stop(startTime + decayTime + 0.01);
    }

    // Highpass filter for brightness
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 7000;

    // Bandpass for tone shaping
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = 10000;
    bpf.Q.value = 1;

    oscGain.connect(hpf);
    hpf.connect(bpf);
    bpf.connect(dest);
}

// ── 808 Tom ─────────────────────────────────────────────────────────────────
// Sine with moderate pitch sweep
function schedule808Tom(
    ctx: BaseAudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number,
    pitch: 'low' | 'mid' | 'high'
): void {
    const vel = velocity / 127;
    const baseFreqs: Record<string, [number, number]> = {
        low: [120, 70],
        mid: [165, 100],
        high: [220, 140],
    };
    const [startFreq, endFreq] = baseFreqs[pitch]!;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, startTime + 0.06);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 0.7, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.35);
}

// ── 808 Cowbell ─────────────────────────────────────────────────────────────
function schedule808Cowbell(
    ctx: BaseAudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number
): void {
    const vel = velocity / 127;
    const freqs = [560, 845]; // Two detuned tones

    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = 700;
    bpf.Q.value = 5;

    const envGain = ctx.createGain();
    envGain.gain.setValueAtTime(vel * 0.5, startTime);
    envGain.gain.exponentialRampToValueAtTime(vel * 0.15, startTime + 0.02);
    envGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

    for (const freq of freqs) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = freq;
        osc.connect(bpf);
        osc.start(startTime);
        osc.stop(startTime + 0.4);
    }

    bpf.connect(envGain);
    envGain.connect(dest);
}

// ── 808 Rimshot ─────────────────────────────────────────────────────────────
function schedule808Rimshot(
    ctx: BaseAudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number
): void {
    const vel = velocity / 127;

    // Click body
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 1700;

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(vel * 0.6, startTime);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.03);

    osc.connect(bodyGain);
    bodyGain.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.04);

    // Noise snap
    const noiseBuffer = createNoiseBuffer(ctx, 0.05);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 6000;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(vel * 0.4, startTime);
    nGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.025);
    noise.connect(hpf);
    hpf.connect(nGain);
    nGain.connect(dest);
    noise.start(startTime);
    noise.stop(startTime + 0.05);
}

// ── 808 Conga ───────────────────────────────────────────────────────────────
function schedule808Conga(
    ctx: BaseAudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number,
    pitch: 'low' | 'mid' | 'high'
): void {
    const vel = velocity / 127;
    const freqMap: Record<string, number> = { low: 200, mid: 310, high: 420 };
    const freq = freqMap[pitch]!;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.5, startTime);
    osc.frequency.exponentialRampToValueAtTime(freq, startTime + 0.01);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 0.6, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.25);
}

// ── 808 Maracas ─────────────────────────────────────────────────────────────
function schedule808Maracas(
    ctx: BaseAudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number
): void {
    const vel = velocity / 127;
    const noiseBuffer = createNoiseBuffer(ctx, 0.1);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 8000;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 0.35, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.07);

    noise.connect(hpf);
    hpf.connect(gain);
    gain.connect(dest);
    noise.start(startTime);
    noise.stop(startTime + 0.1);
}

// ── 808 Clave ───────────────────────────────────────────────────────────────
function schedule808Clave(
    ctx: BaseAudioContext,
    dest: AudioNode,
    startTime: number,
    velocity: number
): void {
    const vel = velocity / 127;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 2500;

    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = 2500;
    bpf.Q.value = 15;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 0.5, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.04);

    osc.connect(bpf);
    bpf.connect(gain);
    gain.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.05);
}

// ── Master dispatcher ───────────────────────────────────────────────────────
export function scheduleDrumVoice(
    ctx: BaseAudioContext,
    dest: AudioNode,
    voiceType: DrumVoiceType,
    startTime: number,
    velocity: number
): void {
    switch (voiceType) {
        case 'kick':
            schedule808Kick(ctx, dest, startTime, velocity);
            break;
        case 'snare':
            schedule808Snare(ctx, dest, startTime, velocity);
            break;
        case 'clap':
            schedule808Clap(ctx, dest, startTime, velocity);
            break;
        case 'closed-hh':
            schedule808HiHat(ctx, dest, startTime, velocity, false);
            break;
        case 'open-hh':
            schedule808HiHat(ctx, dest, startTime, velocity, true);
            break;
        case 'tom-low':
            schedule808Tom(ctx, dest, startTime, velocity, 'low');
            break;
        case 'tom-mid':
            schedule808Tom(ctx, dest, startTime, velocity, 'mid');
            break;
        case 'tom-high':
            schedule808Tom(ctx, dest, startTime, velocity, 'high');
            break;
        case 'cowbell':
            schedule808Cowbell(ctx, dest, startTime, velocity);
            break;
        case 'rimshot':
            schedule808Rimshot(ctx, dest, startTime, velocity);
            break;
        case 'conga-low':
            schedule808Conga(ctx, dest, startTime, velocity, 'low');
            break;
        case 'conga-mid':
            schedule808Conga(ctx, dest, startTime, velocity, 'mid');
            break;
        case 'conga-high':
            schedule808Conga(ctx, dest, startTime, velocity, 'high');
            break;
        case 'maracas':
            schedule808Maracas(ctx, dest, startTime, velocity);
            break;
        case 'clave':
            schedule808Clave(ctx, dest, startTime, velocity);
            break;
    }
}

// ── 808 Kit Definition ──────────────────────────────────────────────────────
export const KIT_808_DEF: DrumKitDef = {
    id: 'kit-808',
    name: '808 Drum Machine',
    voices: [
        { name: 'Kick',       midiNote: 36, type: 'kick' },
        { name: 'Rimshot',    midiNote: 37, type: 'rimshot' },
        { name: 'Snare',      midiNote: 38, type: 'snare' },
        { name: 'Clap',       midiNote: 39, type: 'clap' },
        { name: 'Closed HH',  midiNote: 42, type: 'closed-hh' },
        { name: 'Open HH',    midiNote: 46, type: 'open-hh' },
        { name: 'Tom Low',    midiNote: 43, type: 'tom-low' },
        { name: 'Tom Mid',    midiNote: 47, type: 'tom-mid' },
        { name: 'Tom High',   midiNote: 50, type: 'tom-high' },
        { name: 'Cowbell',    midiNote: 56, type: 'cowbell' },
        { name: 'Conga Low',  midiNote: 64, type: 'conga-low' },
        { name: 'Conga Mid',  midiNote: 63, type: 'conga-mid' },
        { name: 'Conga High', midiNote: 62, type: 'conga-high' },
        { name: 'Maracas',    midiNote: 70, type: 'maracas' },
        { name: 'Clave',      midiNote: 75, type: 'clave' },
    ],
};

// All available kits (more can be added later)
export const DRUM_KIT_DEFS: readonly DrumKitDef[] = [KIT_808_DEF];

export function getDrumKitDefByIndex(index: number): DrumKitDef | null {
    return DRUM_KIT_DEFS[index] ?? null;
}

export function findVoiceByNote(kit: DrumKitDef, midiNote: number): DrumVoiceDef | null {
    return kit.voices.find((v) => v.midiNote === midiNote) ?? null;
}

/**
 * Main entry point: schedule a drum hit for a given MIDI note within a kit.
 */
export function scheduleDrumKitNote(
    ctx: BaseAudioContext,
    dest: AudioNode,
    kit: DrumKitDef,
    midiNote: number,
    startTime: number,
    velocity: number
): void {
    const voice = findVoiceByNote(kit, midiNote);
    if (!voice) {
        return;
    }
    scheduleDrumVoice(ctx, dest, voice.type, startTime, velocity);
}
