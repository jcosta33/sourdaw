import { type AppAction } from '#/utils/handlerContract';

import { midiStore } from '../../stores/midiStore';

import { getRemoveShortMidiOverlapsStatus } from './getRemoveShortMidiOverlapsStatus';
import { projectShortMidiOverlapRemoval } from './projectShortMidiOverlapRemoval';

type RemoveShortMidiOverlapsInput = Extract<AppAction, { type: 'removeShortMidiOverlaps' }>['payload'];

export function removeShortMidiOverlaps(input: RemoveShortMidiOverlapsInput): 'written' | 'no-write' | 'conflict' {
    const status = getRemoveShortMidiOverlapsStatus(input);
    if (status !== 'written') {
        return status;
    }
    const state = midiStore.value!;
    const projected = projectShortMidiOverlapRemoval({
        notes: state.notesByClipId[input.clipId]!,
        tempo: input.expectedTempo,
        maximumOverlapMs: input.maximumOverlapMs,
    })!;
    midiStore.set({
        ...state,
        notesByClipId: { ...state.notesByClipId, [input.clipId]: projected.notes },
    });
    return 'written';
}
