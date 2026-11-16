import { getNotesForClip } from '#/modules/MIDI/useCases';

import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { projectMidiArticulationTransfer } from '../../transformers/projectMidiArticulationTransfer';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'copyMidiArticulations' }>;

export function materializeCopyMidiArticulations(action: Action, state: MaterializationState): MaterializationStep {
    const { context } = state;
    const sourceTarget = context.tracks.flatMap((track) =>
        track.clips.filter((clip) => clip.id === action.payload.sourceClipId).map((clip) => ({ clip, track }))
    )[0];
    const targetTarget = context.tracks.flatMap((track) =>
        track.clips.filter((clip) => clip.id === action.payload.targetClipId).map((clip) => ({ clip, track }))
    )[0];
    if (
        !sourceTarget ||
        !targetTarget ||
        sourceTarget.track.id !== targetTarget.track.id ||
        sourceTarget.track.frozen === true ||
        sourceTarget.clip.type !== 'midi' ||
        targetTarget.clip.type !== 'midi' ||
        sourceTarget.clip.locked === true ||
        targetTarget.clip.locked === true
    ) {
        return { status: 'rejected', reason: 'MF-03 clip pair is unavailable or protected' };
    }
    const expectedSourceNotes = structuredClone(getNotesForClip(action.payload.sourceClipId));
    const expectedTargetNotes = structuredClone(getNotesForClip(action.payload.targetClipId));
    const projectedPairs = projectMidiArticulationTransfer({
        sourceNotes: expectedSourceNotes,
        targetNotes: expectedTargetNotes,
    });
    if (!projectedPairs) {
        return { status: 'rejected', reason: 'MF-03 note topology is incomplete or ambiguous' };
    }
    return {
        status: 'accepted',
        actions: [
            {
                type: 'copyMidiArticulations',
                payload: {
                    trackId: sourceTarget.track.id,
                    sourceClipId: action.payload.sourceClipId,
                    targetClipId: action.payload.targetClipId,
                    notePairs: projectedPairs.map((pair) => ({
                        sourceNoteId: pair.sourceNoteId,
                        targetNoteId: pair.targetNoteId,
                    })),
                    expectedSourceNotes,
                    expectedTargetNotes,
                    expectedTrackFrozen: sourceTarget.track.frozen ?? false,
                    expectedSourceClipLocked: sourceTarget.clip.locked ?? false,
                    expectedTargetClipLocked: targetTarget.clip.locked ?? false,
                },
            },
        ],
    };
}
