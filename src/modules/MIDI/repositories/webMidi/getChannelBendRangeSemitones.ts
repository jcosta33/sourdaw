import { channelControllerState } from './channelControllerState';

/**
 * The pitch-bend sensitivity a channel declared through RPN 0, in semitones
 * (audit MD-8), or `undefined` when this channel never said.
 *
 * Deliberately returns no default: the fallback is a policy decision (MPE
 * member channels inherit their zone master, non-MPE channels fall back to the
 * MIDI 1.0 ±2) and belongs to the use-case layer, so there is one place that
 * decides a bend range rather than one per caller.
 */
export function getChannelBendRangeSemitones(channel: number): number | undefined {
    return channelControllerState.get(channel)?.bendRangeSemitones;
}
