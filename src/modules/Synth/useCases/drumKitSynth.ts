/**
 * Use case: drum kit note scheduling.
 * Delegates to factoryDrumKits for kit data and builtinSynth for audio scheduling.
 */

import { scheduleNote } from './builtinSynth';
import { type DrumKit } from '#/modules/AudioEngine/models/SynthModels';

// Re-export model types and kit data for consumers
export type { DrumKit, DrumKitVoice } from '#/modules/AudioEngine/models/SynthModels';
export { getFactoryDrumKits, getDrumKitById, getDrumKitByIndex } from '#/modules/AudioEngine/helpers/factoryDrumKits';

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
    velocity: number
): OscillatorNode | null {
    const v = findVoice(kit, pitch);
    if (!v) {
        return null;
    }
    return scheduleNote(ctx, destination, pitch, startTime, duration, velocity, v.params);
}
