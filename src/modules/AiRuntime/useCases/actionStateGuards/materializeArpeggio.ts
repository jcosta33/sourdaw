import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'arpeggiate' }>;

export function materializeArpeggio(action: Action, state: MaterializationState): MaterializationStep {
    const { options } = state;
    const scope = options.syncopatedArpeggioScope;
    if (!scope || action.payload.clipId !== scope.clipId) {
        return { status: 'rejected', reason: 'EX-07 syncopated arpeggio scope is unavailable' };
    }
    const reservedNoteIds = new Set(scope.expectedNotes.map((note) => note.id));
    const addedNotes = scope.addedNotes.map((note) => {
        let id = `arp-${crypto.randomUUID()}`;
        while (reservedNoteIds.has(id)) {
            id = `arp-${crypto.randomUUID()}`;
        }
        reservedNoteIds.add(id);
        return { id, ...note };
    });
    return {
        status: 'accepted',
        actions: [
            {
                type: 'arpeggiate',
                payload: {
                    clipId: scope.clipId,
                    pattern: 'up',
                    rate: 8,
                    octaves: 1,
                    gate: 50,
                    expectedTrackId: scope.trackId,
                    trackName: scope.trackName,
                    expectedTrackFrozen: scope.expectedTrackFrozen,
                    clipName: scope.clipName,
                    expectedClipLocked: scope.expectedClipLocked,
                    expectedNotes: structuredClone(scope.expectedNotes),
                    addedNotes,
                },
            },
        ],
    };
}
