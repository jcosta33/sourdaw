/**
 * Use case: lightweight built-in synthesizer note scheduling for offline rendering.
 */

import { type SynthParams } from '#/modules/AudioEngine/useCases';

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
    // Clamp velocity to MIDI range (see scheduleNote). Keeps velAttack >= 0 so
    // offline-rendered envelopes never schedule events before startTime.
    const safeVelocity = Math.max(0, Math.min(127, velocity));
    const frequency = 440 * 2 ** ((pitch - 69) / 12);
    const velAttack = params.attack * (1.5 - safeVelocity / 127);
    const peakGain = (safeVelocity / 127) * params.gain;
    const sustainLevel = peakGain * params.sustain;

    // Single oscillator
    const osc = ctx.createOscillator();
    osc.type = params.waveform;
    osc.frequency.setValueAtTime(frequency, startTime);
    osc.detune.value = params.detune;

    const filter = ctx.createBiquadFilter();
    filter.type = params.filterType;
    const velSens = params.filterVelocitySensitivity ?? 0;
    const velocityScale = velSens > 0 ? 1 - velSens + velSens * (safeVelocity / 127) : 0.3 + 0.7 * (safeVelocity / 127);
    const pitchScale = Math.sqrt(frequency / 440);
    const filterCutoff = Math.min(params.filterCutoff * velocityScale * pitchScale, 20000);

    // Filter envelope: match realtime path
    if (params.filterEnvAmount > 0) {
        const filterPeak = Math.min(filterCutoff + params.filterEnvAmount, 20000);
        filter.frequency.setValueAtTime(filterPeak, startTime);
        const filterAttackEnd = startTime + params.attack;
        const filterDecayEnd = filterAttackEnd + params.decay;
        filter.frequency.setValueAtTime(filterPeak, filterAttackEnd);
        filter.frequency.exponentialRampToValueAtTime(Math.max(filterCutoff, 20), filterDecayEnd);
    } else {
        filter.frequency.setValueAtTime(filterCutoff, startTime);
    }
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
