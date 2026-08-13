import { createHandler } from '#/utils/createHandler';

import { duplicateTrack } from '../../useCases/duplicateTrack';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { publishTrackAdded } from '../../useCases/publishTrackAdded';

type DuplicateTrackAction = { payload: { trackId: string; targetTrackId?: string; select?: boolean } };
const duplicableTrackKinds: ReadonlySet<string> = new Set(['audio', 'midi', 'bus', 'folder']);

function ensureTargetTrackId(action: DuplicateTrackAction): string {
    if (action.payload.targetTrackId) {
        return action.payload.targetTrackId;
    }
    const targetTrackId = `track-dup-${crypto.randomUUID()}`;
    action.payload.targetTrackId = targetTrackId;
    return targetTrackId;
}

export const handleDuplicateTrack = createHandler<'duplicateTrack'>({
    materializeCommandArguments: (action) => {
        ensureTargetTrackId(action);
    },
    execute: (action) => {
        const tracks = getTrackStoreState()?.tracks;
        const source = tracks?.find((track) => track.id === action.payload.trackId);
        if (!source || !duplicableTrackKinds.has(source.kind)) {
            return { status: 'conflict' };
        }
        const options: {
            select?: boolean;
            suppressAddedEvent: boolean;
            targetTrackId: string;
        } = {
            suppressAddedEvent: true,
            targetTrackId: ensureTargetTrackId(action),
        };
        if (action.payload.select !== undefined) {
            options.select = action.payload.select;
        }
        const track = duplicateTrack(action.payload.trackId, options);
        if (!track) {
            return { status: 'conflict' };
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
        const targetTrackId = ensureTargetTrackId(action);
        const tracks = getTrackStoreState()?.tracks;
        const source = tracks?.find((track) => track.id === action.payload.trackId);
        const sourceIsDuplicable = source ? duplicableTrackKinds.has(source.kind) : false;
        const targetExists = tracks?.some((track) => track.id === targetTrackId) ?? true;
        return {
            label: 'Duplicate track',
            inverseAction:
                sourceIsDuplicable && !targetExists
                    ? { type: 'discardCreatedTrack', payload: { trackId: targetTrackId } }
                    : null,
        };
    },
    isNoop: (action) => {
        const tracks = getTrackStoreState()?.tracks;
        if (!tracks) {
            return false;
        }
        const targetTrackId = action.payload.targetTrackId;
        return targetTrackId !== undefined && tracks.some((track) => track.id === targetTrackId);
    },
    requiresAbortCompensation: false,
    undoable: true,
});
