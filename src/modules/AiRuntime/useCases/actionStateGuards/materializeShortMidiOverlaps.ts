import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'removeShortMidiOverlaps' }>;

export function materializeShortMidiOverlaps(action: Action, state: MaterializationState): MaterializationStep {
    const { options } = state;
    const scope = options.midiOverlapTransformScope;
    const entry = scope?.entries.find(
        (candidate) =>
            candidate.clipId === action.payload.clipId && scope.maximumOverlapMs === action.payload.maximumOverlapMs
    );
    if (!scope || !entry) {
        return { status: 'rejected', reason: 'EX-04 selected MIDI overlap scope is unavailable' };
    }
    return {
        status: 'accepted',
        actions: [
            {
                type: 'removeShortMidiOverlaps',
                payload: {
                    clipId: entry.clipId,
                    maximumOverlapMs: scope.maximumOverlapMs,
                    expectedTempo: scope.tempo,
                    expectedTrackId: entry.trackId,
                    trackName: entry.trackName,
                    expectedTrackFrozen: entry.expectedTrackFrozen,
                    clipName: entry.clipName,
                    expectedClipLocked: entry.expectedClipLocked,
                    expectedNotes: structuredClone(entry.expectedNotes),
                },
            },
        ],
    };
}
