/**
 * Use case: drum kit note scheduling.
 * Delegates to factoryDrumKits for kit data and builtinSynth for audio scheduling.
 */

import { scheduleNote } from './builtinSynth';

import type { SynthParams } from '#/modules/AudioEngine/useCases';

// Synth-local shape (AGENTS.md §95 — model isolation). Structurally compatible
// with AudioEngine's DrumKit model; no cross-module model import.
export type DrumKitVoice = {
    name: string;
    pitchRange: [number, number];
    params: SynthParams;
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

export function scheduleKitNote(
    ctx: BaseAudioContext,
    destination: AudioNode,
    kit: DrumKit,
    pitch: number,
    startTime: number,
    duration: number,
    velocity: number,
    clipGain: number = 1.0
): OscillatorNode | null {
    const v = findVoice(kit, pitch);
    if (!v) {
        return null;
    }
    return scheduleNote(ctx, destination, pitch, startTime, duration, velocity, v.params, undefined, clipGain);
}
