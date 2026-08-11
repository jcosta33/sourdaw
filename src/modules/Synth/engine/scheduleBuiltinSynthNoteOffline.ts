/** Synth-private adapter that keeps offline notes on the realtime graph owner. */

import { type BuiltinSynthMpeParams, type BuiltinSynthParams } from '../models/BuiltinSynthTypes';

import { scheduleBuiltinSynthNote } from './scheduleBuiltinSynthNote';

/**
 * Offline rendering deliberately builds the same graph as monitored playback.
 * Export fidelity takes precedence over the former reduced-node approximation.
 */
type ScheduleBuiltinSynthNoteOfflineInput = {
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

export function scheduleBuiltinSynthNoteOffline({
    ctx,
    destination,
    pitch,
    startTime,
    duration,
    velocity,
    params,
    mpe,
    clipGain,
}: ScheduleBuiltinSynthNoteOfflineInput): void {
    scheduleBuiltinSynthNote({
        ctx,
        destination,
        pitch,
        startTime,
        duration,
        velocity,
        params,
        mpe,
        clipGain,
    });
}
