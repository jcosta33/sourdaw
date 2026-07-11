import { scheduleBuiltinSynthNoteOffline } from '../engine/scheduleBuiltinSynthNoteOffline';
import { type BuiltinSynthParams } from '../models/BuiltinSynthTypes';

export function scheduleNoteOffline(
    ctx: BaseAudioContext,
    destination: AudioNode,
    pitch: number,
    startTime: number,
    duration: number,
    velocity: number,
    params: BuiltinSynthParams
): void {
    scheduleBuiltinSynthNoteOffline({ ctx, destination, pitch, startTime, duration, velocity, params });
}
