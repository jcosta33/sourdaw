import { createHandler } from '#/utils/createHandler';

import { addTrack } from '../../useCases/addTrack';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { publishTrackAdded } from '../../useCases/publishTrackAdded';

type AddTrackAction = {
    payload: {
        color?: string;
        gain?: number;
        id?: string;
        initialAlternativeId?: string;
        initialDeviceId?: string;
        name: string;
        kind: string;
        select?: boolean;
    };
};

function ensureTrackId(action: AddTrackAction): string {
    if (action.payload.id) {
        return action.payload.id;
    }
    const trackId = `track-ai-${crypto.randomUUID()}`;
    action.payload.id = trackId;
    return trackId;
}

export const handleAddTrack = createHandler<'addTrack'>({
    validate: (action) => {
        const trackId = ensureTrackId(action);
        const state = getTrackStoreState();
        return state !== null && !state.tracks.some((track) => track.id === trackId);
    },
    execute: (action) => {
        ensureTrackId(action);
        const track = addTrack({ ...action.payload, suppressAddedEvent: true });
        if (!track) {
            return { status: 'no-write' };
        }
        return {
            status: 'written',
            afterCommit: () =>
                publishTrackAdded({
                    trackId: track.id,
                    name: track.name,
                    kind: track.kind,
                }),
            afterAmbiguousCommit: async () => {
                const committedTrack = getTrackStoreState()?.tracks.find((candidate) => candidate.id === track.id);
                if (!committedTrack) {
                    return;
                }
                await publishTrackAdded({
                    trackId: committedTrack.id,
                    name: committedTrack.name,
                    kind: committedTrack.kind,
                });
            },
        };
    },
    describe: (action) => {
        const trackId = ensureTrackId(action);
        const state = getTrackStoreState();
        const collides = state?.tracks.some((track) => track.id === trackId) ?? true;
        return {
            label: `Add ${action.payload.kind} track "${action.payload.name}"`,
            inverseAction: collides ? null : { type: 'discardCreatedTrack', payload: { trackId } },
        };
    },
    isNoop: (action) => {
        const state = getTrackStoreState();
        if (!state) {
            return true;
        }
        const trackId = action.payload.id;
        return trackId !== undefined && state.tracks.some((track) => track.id === trackId);
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
