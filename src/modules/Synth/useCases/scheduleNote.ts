import { scheduleBuiltinSynthNote } from '../engine/scheduleBuiltinSynthNote';
import { type BuiltinSynthMpeParams, type BuiltinSynthParams } from '../models/BuiltinSynthTypes';

export function scheduleNote(
    ctx: BaseAudioContext,
    destination: AudioNode,
    pitch: number,
    startTime: number,
    duration: number,
    velocity: number,
    params: BuiltinSynthParams,
    mpe?: BuiltinSynthMpeParams,
    clipGain: number = 1.0
): OscillatorNode & { _env: GainNode } {
    return scheduleBuiltinSynthNote({
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
