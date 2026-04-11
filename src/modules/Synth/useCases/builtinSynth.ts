/**
 * Use case: built-in synthesizer note scheduling and parameter resolution.
 * Delegates to SynthModels for types/defaults.
 */

import {
    defaultSynthParams,
    type MpeParams,
    type SynthParams,
} from '#/modules/AudioEngine/useCases';

// Consumer-local shape (AGENTS.md §95 — model isolation). Only fields used here.
type Device = { type: string; parameterValues: Record<string, number> };

const SYNTH_PARAM_KEYS: ReadonlyArray<keyof SynthParams> = [
    'waveform',
    'attack',
    'decay',
    'sustain',
    'release',
    'filterCutoff',
    'filterResonance',
    'filterType',
    'filterEnvAmount',
    'detune',
    'gain',
    'osc2Waveform',
    'osc2Detune',
    'osc2Mix',
    'subOscLevel',
    'noiseLevel',
    'vibratoRate',
    'vibratoDepth',
    'vibratoDelay',
    'stereoSpread',
    'filterVelocitySensitivity',
];

const WAVEFORMS = new Set<string>(['sine', 'triangle', 'sawtooth', 'square']);
const FILTER_TYPES = new Set<string>(['lowpass', 'highpass', 'bandpass']);

const WAVEFORM_INDEX: Record<number, SynthParams['waveform']> = {
    0: 'sine',
    1: 'triangle',
    2: 'sawtooth',
    3: 'square',
};

const FILTER_TYPE_INDEX: Record<number, SynthParams['filterType']> = {
    0: 'lowpass',
    1: 'highpass',
    2: 'bandpass',
};

function resolveEnumParam<T extends string>(
    raw: number | string | undefined,
    allowed: Set<string>,
    indexMap: Record<number, T>,
    fallback: T
): T {
    if (raw === undefined) {
        return fallback;
    }
    if (typeof raw === 'string' && allowed.has(raw)) {
        return raw as T;
    }
    if (typeof raw === 'number' && indexMap[raw] !== undefined) {
        return indexMap[raw];
    }
    return fallback;
}

const MPE_BEND_RANGE_SEMITONES = 48;

export function scheduleNote(
    ctx: BaseAudioContext,
    destination: AudioNode,
    pitch: number,
    startTime: number,
    duration: number,
    velocity: number,
    params: SynthParams,
    mpe?: MpeParams,
    clipGain: number = 1.0
): OscillatorNode {
    const baseFrequency = 440 * 2 ** ((pitch - 69) / 12);
    // Velocity-sensitive attack: harder hits = faster attack (real instrument behavior)
    const velAttack = params.attack * (1.5 - velocity / 127);
    const peakGain = (velocity / 127) * params.gain * clipGain;
    const sustainLevel = peakGain * params.sustain;

    let frequency = baseFrequency;
    if (mpe?.pitchBend !== undefined) {
        const bendSemitones = (mpe.pitchBend / 8192) * MPE_BEND_RANGE_SEMITONES;
        frequency = baseFrequency * 2 ** (bendSemitones / 12);
    }

    // Mixer before filter
    const mixer = ctx.createGain();

    // Track all nodes for cleanup
    const cleanupNodes: AudioNode[] = [mixer];
    let osc2: OscillatorNode | null = null;
    let subOsc: OscillatorNode | null = null;

    // -- Primary oscillator --
    const osc1 = ctx.createOscillator();
    osc1.type = params.waveform;
    osc1.frequency.setValueAtTime(frequency, startTime);
    osc1.detune.value = params.detune;
    const osc1Gain = ctx.createGain();
    osc1Gain.gain.value = params.osc2Mix > 0 ? 1 - params.osc2Mix : 1;
    osc1.connect(osc1Gain);
    cleanupNodes.push(osc1, osc1Gain);

    // Stereo spread: pan osc1 left and osc2 right for spatial width
    if (params.stereoSpread > 0 && params.osc2Mix > 0) {
        const pan1 = new StereoPannerNode(ctx, { pan: -params.stereoSpread });
        osc1Gain.connect(pan1);
        pan1.connect(mixer);
        cleanupNodes.push(pan1);
    } else {
        osc1Gain.connect(mixer);
    }

    // -- Second oscillator (if osc2Mix > 0) --
    if (params.osc2Mix > 0) {
        osc2 = ctx.createOscillator();
        osc2.type = params.osc2Waveform;
        osc2.frequency.setValueAtTime(frequency, startTime);
        osc2.detune.value = params.detune + params.osc2Detune;
        const osc2Gain = ctx.createGain();
        osc2Gain.gain.value = params.osc2Mix;
        osc2.connect(osc2Gain);

        // Stereo spread: pan osc2 to the right
        if (params.stereoSpread > 0) {
            const pan2 = new StereoPannerNode(ctx, { pan: params.stereoSpread });
            osc2Gain.connect(pan2);
            pan2.connect(mixer);
            cleanupNodes.push(pan2);
        } else {
            osc2Gain.connect(mixer);
        }
        cleanupNodes.push(osc2, osc2Gain);
    }

    // -- Sub-oscillator (one octave below, if subOscLevel > 0) --
    if (params.subOscLevel > 0) {
        subOsc = ctx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(frequency / 2, startTime);
        const subGain = ctx.createGain();
        subGain.gain.value = params.subOscLevel;
        subOsc.connect(subGain);
        subGain.connect(mixer);
        cleanupNodes.push(subOsc, subGain);
    }

    // -- Noise layer (if noiseLevel > 0) --
    // Uses a fast 50ms decay envelope to simulate pluck/hammer attack transients
    let noiseSource: AudioBufferSourceNode | null = null;
    if (params.noiseLevel > 0) {
        const noiseAttackDecay = 0.05; // 50ms burst
        const noiseDuration = noiseAttackDecay + 0.05; // short burst + tail
        const noiseLen = Math.ceil(ctx.sampleRate * noiseDuration);
        const noiseBuffer = new AudioBuffer({ numberOfChannels: 1, length: noiseLen, sampleRate: ctx.sampleRate });
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseLen; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        const noiseGain = ctx.createGain();
        // Fast attack-decay envelope for the noise burst
        noiseGain.gain.setValueAtTime(params.noiseLevel * 0.5, startTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + noiseAttackDecay);
        noiseSource.connect(noiseGain);
        noiseGain.connect(mixer);
        cleanupNodes.push(noiseGain);
    }

    // -- Filter with velocity sensitivity and pitch tracking --
    const filter = ctx.createBiquadFilter();
    filter.type = params.filterType;

    // Velocity → filter brightness: harder hits open the filter more
    const velSens = params.filterVelocitySensitivity ?? 0;
    const velocityScale =
        velSens > 0
            ? 1 - velSens + velSens * (velocity / 127) // 0 sens = always full, 1 sens = full range
            : 0.3 + 0.7 * (velocity / 127); // legacy default when param not set
    // Pitch tracking: higher notes are naturally brighter (scale by sqrt of freq ratio)
    const pitchScale = Math.sqrt(frequency / 440);
    let filterCutoff = Math.min(params.filterCutoff * velocityScale * pitchScale, 20000);
    if (mpe?.pressure !== undefined) {
        filterCutoff = Math.min(20000, filterCutoff + (mpe.pressure / 127) * 2000);
    }

    // Filter envelope: starts at cutoff+envAmount, decays to cutoff
    // This creates bright-attack-to-dark-sustain character (piano, bells, plucks)
    if (params.filterEnvAmount > 0) {
        const filterPeak = Math.min(filterCutoff + params.filterEnvAmount, 20000);
        filter.frequency.setValueAtTime(filterPeak, startTime);
        const filterAttackEnd = startTime + params.attack;
        const filterDecayEnd = filterAttackEnd + params.decay;
        // Hold at peak during attack, then sweep down during decay
        filter.frequency.setValueAtTime(filterPeak, filterAttackEnd);
        filter.frequency.exponentialRampToValueAtTime(Math.max(filterCutoff, 20), filterDecayEnd);
    } else {
        filter.frequency.setValueAtTime(filterCutoff, startTime);
    }

    let filterQ = params.filterResonance;
    if (mpe?.slide !== undefined) {
        filterQ = (mpe.slide / 127) * 20;
    }
    filter.Q.setValueAtTime(filterQ, startTime);

    // -- Envelope (using velocity-sensitive attack) --
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, startTime);

    const attackEnd = startTime + velAttack;
    const decayEnd = attackEnd + params.decay;
    const releaseStart = startTime + duration;
    const releaseEnd = releaseStart + params.release;

    env.gain.linearRampToValueAtTime(peakGain, attackEnd);

    if (decayEnd < releaseStart) {
        env.gain.linearRampToValueAtTime(sustainLevel, decayEnd);
        env.gain.setValueAtTime(sustainLevel, releaseStart);
    } else {
        env.gain.linearRampToValueAtTime(sustainLevel, releaseStart);
    }

    env.gain.linearRampToValueAtTime(0, releaseEnd);

    // -- Signal chain: mixer -> filter -> env -> destination --
    mixer.connect(filter);
    filter.connect(env);
    env.connect(destination);
    cleanupNodes.push(filter, env);

    // -- Vibrato LFO (pitch modulation after attack phase) --
    let vibratoLfo: OscillatorNode | null = null;
    if (params.vibratoRate > 0 && params.vibratoDepth > 0) {
        vibratoLfo = ctx.createOscillator();
        vibratoLfo.type = 'sine';
        vibratoLfo.frequency.setValueAtTime(params.vibratoRate, startTime);
        const vibratoGain = ctx.createGain();
        // Ramp vibrato in after delay period so it doesn't wobble the onset
        const vibDelay = params.vibratoDelay ?? 0.3;
        vibratoGain.gain.setValueAtTime(0, startTime);
        vibratoGain.gain.linearRampToValueAtTime(0, attackEnd + vibDelay);
        vibratoGain.gain.linearRampToValueAtTime(params.vibratoDepth, attackEnd + vibDelay + 0.1);
        vibratoLfo.connect(vibratoGain);
        // Connect to all oscillators' detune params
        vibratoGain.connect(osc1.detune);
        if (osc2) {
            vibratoGain.connect(osc2.detune);
        }
        if (subOsc) {
            vibratoGain.connect(subOsc.detune);
        }
        cleanupNodes.push(vibratoLfo, vibratoGain);
    }

    // -- Start all sources --
    osc1.start(startTime);
    osc1.stop(releaseEnd + 0.01);
    if (osc2) {
        osc2.start(startTime);
        osc2.stop(releaseEnd + 0.01);
    }
    if (subOsc) {
        subOsc.start(startTime);
        subOsc.stop(releaseEnd + 0.01);
    }
    if (noiseSource) {
        noiseSource.start(startTime);
        noiseSource.stop(releaseEnd + 0.01);
    }
    if (vibratoLfo) {
        vibratoLfo.start(startTime);
        vibratoLfo.stop(releaseEnd + 0.01);
    }

    osc1.onended = () => {
        for (const node of cleanupNodes) {
            try {
                node.disconnect();
            } catch {
                /* already disconnected */
            }
        }
    };

    return osc1;
}

/**
 * Resolve synth params from an array of device descriptors.
 * Prefer this over `getSynthParamsForTrack` during offline rendering
 * to avoid re-reading the live store mid-render.
 */
export function getSynthParamsFromDevices(devices: Device[]): SynthParams {
    const synthDevice = devices.find((d) => d.type === 'synth' || d.type.startsWith('builtin-synth'));
    if (!synthDevice) {
        return { ...defaultSynthParams };
    }

    const pv = synthDevice.parameterValues;
    const result: SynthParams = { ...defaultSynthParams };

    for (const key of SYNTH_PARAM_KEYS) {
        const raw = pv[key];
        if (raw === undefined) {
            continue;
        }

        if (key === 'waveform') {
            result.waveform = resolveEnumParam(raw, WAVEFORMS, WAVEFORM_INDEX, defaultSynthParams.waveform);
        } else if (key === 'osc2Waveform') {
            result.osc2Waveform = resolveEnumParam(raw, WAVEFORMS, WAVEFORM_INDEX, defaultSynthParams.osc2Waveform);
        } else if (key === 'filterType') {
            result.filterType = resolveEnumParam(raw, FILTER_TYPES, FILTER_TYPE_INDEX, defaultSynthParams.filterType);
        } else {
            (result as unknown as Record<string, number>)[key] = raw;
        }
    }

    return result;
}

/**
 * Lightweight note scheduling for offline rendering.
 * Creates only 3 nodes per note (osc + filter + env) instead of 4-10+.
 * Skips: osc2, sub-osc, noise layer, vibrato LFO, stereo spread.
 * This reduces node count by ~60% while preserving core timbre.
 */
export function scheduleNoteOffline(
    ctx: BaseAudioContext,
    destination: AudioNode,
    pitch: number,
    startTime: number,
    duration: number,
    velocity: number,
    params: SynthParams
): void {
    const frequency = 440 * 2 ** ((pitch - 69) / 12);
    const velAttack = params.attack * (1.5 - velocity / 127);
    const peakGain = (velocity / 127) * params.gain;
    const sustainLevel = peakGain * params.sustain;

    // Single oscillator
    const osc = ctx.createOscillator();
    osc.type = params.waveform;
    osc.frequency.setValueAtTime(frequency, startTime);
    osc.detune.value = params.detune;

    // Simplified filter (no envelope modulation)
    const filter = ctx.createBiquadFilter();
    filter.type = params.filterType;
    const velocityScale = 0.3 + 0.7 * (velocity / 127);
    filter.frequency.setValueAtTime(Math.min(params.filterCutoff * velocityScale, 20000), startTime);
    filter.Q.setValueAtTime(params.filterResonance, startTime);

    // Amplitude envelope
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, startTime);

    const attackEnd = startTime + velAttack;
    const decayEnd = attackEnd + params.decay;
    const releaseStart = startTime + duration;
    const releaseEnd = releaseStart + params.release;

    env.gain.linearRampToValueAtTime(peakGain, attackEnd);
    if (decayEnd < releaseStart) {
        env.gain.linearRampToValueAtTime(sustainLevel, decayEnd);
        env.gain.setValueAtTime(sustainLevel, releaseStart);
    } else {
        env.gain.linearRampToValueAtTime(sustainLevel, releaseStart);
    }
    env.gain.linearRampToValueAtTime(0, releaseEnd);

    // Chain: osc → filter → env → destination
    osc.connect(filter);
    filter.connect(env);
    env.connect(destination);

    osc.start(startTime);
    osc.stop(releaseEnd + 0.01);
}
