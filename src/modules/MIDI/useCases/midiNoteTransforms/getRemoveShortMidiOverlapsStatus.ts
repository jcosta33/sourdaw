import { trackStore } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';
import { type AppAction } from '#/utils/handlerContract';

import { midiStore } from '../../stores/midiStore';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';

import { projectShortMidiOverlapRemoval } from './projectShortMidiOverlapRemoval';

type RemoveShortMidiOverlapsInput = Extract<AppAction, { type: 'removeShortMidiOverlaps' }>['payload'];

export function getRemoveShortMidiOverlapsStatus(
    input: RemoveShortMidiOverlapsInput
): 'written' | 'no-write' | 'conflict' {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === input.expectedTrackId);
    const clip = track?.clips.find((candidate) => candidate.id === input.clipId);
    const state = midiStore.value;
    const currentNotes = state?.notesByClipId[input.clipId];
    if (
        !track ||
        !clip ||
        clip.type !== 'midi' ||
        !state ||
        !currentNotes ||
        transportStore.value?.tempo !== input.expectedTempo ||
        (track.frozen === true) !== input.expectedTrackFrozen ||
        (clip.locked === true) !== input.expectedClipLocked ||
        !midiNotesEqual(currentNotes, input.expectedNotes)
    ) {
        return 'conflict';
    }
    const projected = projectShortMidiOverlapRemoval({
        notes: currentNotes,
        tempo: input.expectedTempo,
        maximumOverlapMs: input.maximumOverlapMs,
    });
    if (!projected) {
        return 'conflict';
    }
    return midiNotesEqual(currentNotes, projected.notes) ? 'no-write' : 'written';
}
