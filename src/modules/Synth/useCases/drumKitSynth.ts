/**
 * Use case: drum kit note scheduling.
 * Delegates to factoryDrumKits for kit data and scheduleNote for audio scheduling.
 */

import { type BuiltinSynthParams } from '../models/BuiltinSynthTypes';

import { scheduleNote } from './scheduleNote';

// Synth-local shape (AGENTS.md §95 — model isolation). Structurally compatible
// with AudioEngine's DrumKit model; no cross-module model import.
export type DrumKitVoice = {
    name: string;
    pitchRange: [number, number];
    params: BuiltinSynthParams;
};

export type DrumKit = {
    id: string;
    name: string;
    voices: DrumKitVoice[];
};

function findVoice(kit: DrumKit, pitch: number): DrumKit['voices'][number] | null {
    for (const v of kit.voices) {
        if (pitch >= v.pitchRange[0] && pitch <= v.pitchRange[1]) {
            return v;
        }
    }
    return null;
}

/**
 * Schedule one hit of a factory kit as a builtin synth voice. The kit's linear
 * `kitGain` multiplies the clip gain the voice's peak level already scales by,
 * so it trims every hit by the same ratio.
 */
export function scheduleKitNote(
    ctx: BaseAudioContext,
    destination: AudioNode,
    kit: DrumKit,
    pitch: number,
    startTime: number,
    duration: number,
    velocity: number,
    clipGain: number,
    kitGain: number
): OscillatorNode | null {
    const v = findVoice(kit, pitch);
    if (!v) {
        return null;
    }
    return scheduleNote(
        ctx,
        destination,
        pitch,
        startTime,
        duration,
        velocity,
        v.params,
        undefined,
        clipGain * kitGain
    );
}
