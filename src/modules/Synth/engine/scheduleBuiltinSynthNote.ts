/**
 * Synth-private engine owner for realtime built-in synthesizer note scheduling.
 */

import { type BuiltinSynthMpeParams, type BuiltinSynthParams } from '../models/BuiltinSynthTypes';

// Pre-generated noise buffer (§54.1 — avoid per-note AudioBuffer allocation).
// Cached by AudioContext sample rate — reused across every note until the
// context sample rate changes. Not observable externally, so a plain
// module-level `let` is the idiomatic shape per docs/03-state-management.md.
let cachedNoiseBuffer: AudioBuffer | null = null;
function getNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
    if (cachedNoiseBuffer && cachedNoiseBuffer.sampleRate === ctx.sampleRate) {
        return cachedNoiseBuffer;
    }
    const len = Math.ceil(ctx.sampleRate * 0.1); // 100ms of noise
    const buf = new AudioBuffer({ numberOfChannels: 1, length: len, sampleRate: ctx.sampleRate });
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    cachedNoiseBuffer = buf;
    return buf;
}

type ScheduleBuiltinSynthNoteInput = {
    ctx: BaseAudioContext;
    destination: AudioNode;
    pitch: number;
    startTime: number;
    duration: number;
    velocity: number;
    params: BuiltinSynthParams;
    mpe?: BuiltinSynthMpeParams;
    clipGain: number;
};

export function scheduleBuiltinSynthNote({
    ctx,
    destination,
    pitch,
    startTime,
    duration,
    velocity,
    params,
    mpe,
    clipGain,
}: ScheduleBuiltinSynthNoteInput): OscillatorNode & { _env: GainNode } {
    // Clamp velocity to MIDI range before it drives any timing/gain math. An
    // out-of-range value would make velAttack negative (velocity > 190.5),
    // scheduling envelope/filter events in the past. Mirrors the clamp in
    // scheduleDrumKitNote / scheduleFaustNote.
    const safeVelocity = Math.max(0, Math.min(127, velocity));
    const baseFrequency = 440 * 2 ** ((pitch - 69) / 12);
    // Velocity-sensitive attack: harder hits = faster attack (real instrument behavior)
    const velAttack = params.attack * (1.5 - safeVelocity / 127);
    const peakGain = (safeVelocity / 127) * params.gain * clipGain;
    const sustainLevel = peakGain * params.sustain;

    let frequency = baseFrequency;
    // The range comes from the caller, never from a constant here. This file
    // used to hold its own `MPE_BEND_RANGE_SEMITONES = 48`, which is how a bend
    // recorded on a controller set to ±12 played back four times too deep
    // (audit MD-8).
    if (mpe?.pitchBend !== undefined && mpe.pitchBendRangeSemitones !== undefined) {
        const bendSemitones = (mpe.pitchBend / 8192) * mpe.pitchBendRangeSemitones;
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
        noiseSource = ctx.createBufferSource();
        noiseSource.buffer = getNoiseBuffer(ctx);
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

    // Velocity → filter brightness: harder hits open the filter more.
    // When explicitly provided (including 0), use linear sensitivity scaling:
    // 0 sens = always full (disabled), 1 sens = full range (0 to 1).
    // When undefined (legacy callers), fall back to legacy default (0.3 + 0.7 * vel/127).
    const velSens = params.filterVelocitySensitivity;
    const velocityScale =
        velSens !== undefined ? 1 - velSens + velSens * (safeVelocity / 127) : 0.3 + 0.7 * (safeVelocity / 127);
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

    if (releaseStart <= attackEnd) {
        // Note released during attack: ramp only up to the interpolated level reached at note-off
        const attackProgress = velAttack > 0 ? (releaseStart - startTime) / velAttack : 1;
        const currentGain = peakGain * Math.max(0, Math.min(1, attackProgress));
        env.gain.linearRampToValueAtTime(currentGain, releaseStart);
    } else if (releaseStart < decayEnd) {
        // Note released during decay: complete attack, then ramp down to interpolated decay level
        env.gain.linearRampToValueAtTime(peakGain, attackEnd);
        const decayProgress = params.decay > 0 ? (releaseStart - attackEnd) / params.decay : 1;
        const currentGain = peakGain + (sustainLevel - peakGain) * Math.max(0, Math.min(1, decayProgress));
        env.gain.linearRampToValueAtTime(currentGain, releaseStart);
    } else {
        // Note sustained: full attack and decay, hold at sustain until note-off
        env.gain.linearRampToValueAtTime(peakGain, attackEnd);
        env.gain.linearRampToValueAtTime(sustainLevel, decayEnd);
        if (releaseStart > decayEnd) {
            env.gain.setValueAtTime(sustainLevel, releaseStart);
        }
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

    // Expose the amplitude-envelope GainNode on the returned oscillator so
    // note-off handlers (audition, live MIDI, MIDI reset) can apply the
    // exponential smooth release instead of hard-stopping the oscillator.
    const result = osc1 as OscillatorNode & { _env: GainNode };
    result._env = env;
    return result;
}
