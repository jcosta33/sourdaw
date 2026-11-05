import { type AppAction } from '#/utils/handlerContract';

import { midiStore } from '../stores/midiStore';

import {
    projectMidiClipDataThroughRestores,
    type ProjectedMidiClipData,
} from './midiClipData/projectMidiClipDataThroughRestores';

function readMidiClipData(priorBatchActions: readonly AppAction[] | undefined): ProjectedMidiClipData {
    if (priorBatchActions) {
        return projectMidiClipDataThroughRestores(priorBatchActions);
    }
    const state = midiStore.value;
    return {
        notesByClipId: state?.notesByClipId ?? {},
        ccByClipId: state?.ccByClipId ?? {},
        pitchBendByClipId: state?.pitchBendByClipId ?? {},
    };
}

/**
 * The canonical MIDI state of the clips, as a generated-state guard pins it.
 * With `priorBatchActions` it is the state those earlier batch members leave
 * behind (see `projectMidiClipDataThroughRestores`) rather than the live store.
 */
export function serializeMidiStateForClips(
    clipIds: readonly string[],
    priorBatchActions?: readonly AppAction[]
): string {
    const state = midiStore.value;
    const { notesByClipId, ccByClipId, pitchBendByClipId } = readMidiClipData(priorBatchActions);
    const clips: Record<string, unknown> = {};

    for (const clipId of clipIds) {
        clips[clipId] = {
            notes: {
                present: Object.hasOwn(notesByClipId, clipId),
                value: notesByClipId[clipId] ?? [],
            },
            cc: {
                present: Object.hasOwn(ccByClipId, clipId),
                value: ccByClipId[clipId] ?? [],
            },
            pitchBends: {
                present: Object.hasOwn(pitchBendByClipId, clipId),
                value: pitchBendByClipId[clipId] ?? [],
            },
            migrated: state?.migratedAbsoluteNoteClipIds?.includes(clipId) ?? false,
        };
    }

    return JSON.stringify(clips);
}
