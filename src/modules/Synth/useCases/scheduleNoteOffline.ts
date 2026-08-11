import { scheduleBuiltinSynthNoteOffline } from '../engine/scheduleBuiltinSynthNoteOffline';
import { type BuiltinSynthMpeParams, type BuiltinSynthParams } from '../models/BuiltinSynthTypes';

export function scheduleNoteOffline(
    ctx: BaseAudioContext,
    destination: AudioNode,
    pitch: number,
    startTime: number,
    duration: number,
    velocity: number,
    params: BuiltinSynthParams,
    mpe?: BuiltinSynthMpeParams,
    clipGain: number = 1.0
): void {
    scheduleBuiltinSynthNoteOffline({ ctx, destination, pitch, startTime, duration, velocity, params, mpe, clipGain });
}
