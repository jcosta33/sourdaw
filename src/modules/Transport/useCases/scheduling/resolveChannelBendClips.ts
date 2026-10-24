import { type MidiStoreState } from '#/modules/MIDI/stores';

import { resolvePlayedMidiClips } from './resolvePlayedMidiClips';

type ResolveChannelBendClipsInput = {
    trackId: string;
    clips: Parameters<typeof resolvePlayedMidiClips>[1];
    notesByClipId: NonNullable<MidiStoreState>['notesByClipId'];
    ccByClipId: NonNullable<MidiStoreState>['ccByClipId'];
    pitchBendByClipId: NonNullable<MidiStoreState>['pitchBendByClipId'];
};

/**
 * The clips of a track whose stored channel pitch bend plays, wherever they sit against a
 * scheduler window: the bend in force at a note's start is the last move any of them left, as
 * continuous playback holds it. They are the clips the window scheduler would play by its own
 * rules, the ones `resolveStoredControllerClips` admits (a muted clip and the parts of a clip a
 * comp region replaces do not play; a clip with no note list plays no notes but still bends the
 * notes of the clips around it), in the order it posts them. Each carries its controllers too,
 * because the RPN messages among them say how deep its bend is.
 *
 * A clip that stores no bend is still admitted when it holds notes: the channels they sound on say
 * whether a master-channel bend is an MPE zone master's (`projectChannelBend`), and a note decides
 * that for the whole track whichever clip it sits in.
 */
export function resolveChannelBendClips({
    trackId,
    clips,
    notesByClipId,
    ccByClipId,
    pitchBendByClipId,
}: ResolveChannelBendClipsInput) {
    return resolvePlayedMidiClips(trackId, clips).flatMap((clip) => {
        const pitchBends = pitchBendByClipId[clip.id] ?? [];
        const notes = notesByClipId[clip.id] ?? [];
        if (pitchBends.length === 0 && notes.length === 0) {
            return [];
        }
        return [{ clip, controlChanges: ccByClipId[clip.id] ?? [], pitchBends, notes }];
    });
}
