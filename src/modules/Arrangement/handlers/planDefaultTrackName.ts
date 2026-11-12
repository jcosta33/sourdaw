import { type AppAction, type HandlerMaterializationContext } from '#/utils/handlerContract';

import { nextDefaultTrackName } from '../models/DefaultTrackName';
import { type TrackKind } from '../models/Track';
import { getTrackStoreState } from '../useCases/getTrackStoreState';

type PlannedTrackName = { readonly id?: string; readonly kind: string; readonly name: string };

const trackKinds: ReadonlySet<string> = new Set(['audio', 'midi', 'bus', 'master', 'folder']);

function restoredTrackName(action: Extract<AppAction, { type: 'restoreTrack' }>): PlannedTrackName {
    const snapshot: unknown = action.payload.trackSnapshot;
    if (
        typeof snapshot !== 'object' ||
        snapshot === null ||
        Array.isArray(snapshot) ||
        !('id' in snapshot) ||
        typeof snapshot.id !== 'string' ||
        snapshot.id.length === 0 ||
        snapshot.id !== action.payload.trackId ||
        !('kind' in snapshot) ||
        typeof snapshot.kind !== 'string' ||
        !trackKinds.has(snapshot.kind) ||
        !('name' in snapshot) ||
        typeof snapshot.name !== 'string'
    ) {
        throw new TypeError('Cannot plan a default track name from a malformed restored track');
    }
    return { id: snapshot.id, kind: snapshot.kind, name: snapshot.name };
}

function projectTrackNames(tracks: PlannedTrackName[], action: AppAction): PlannedTrackName[] {
    switch (action.type) {
        case 'addTrack':
            return [
                ...tracks,
                {
                    id: action.payload.id,
                    kind: action.payload.kind,
                    name: action.payload.name ?? nextDefaultTrackName(action.payload.kind, tracks),
                },
            ];
        case 'createBus':
            return [...tracks, { id: action.payload.busId, kind: 'bus', name: action.payload.name }];
        case 'renameTrack':
            return tracks.map((track) => {
                if (track.id !== action.payload.trackId) {
                    return track;
                }
                return { ...track, name: action.payload.name };
            });
        case 'removeTrack':
        case 'discardCreatedTrack':
            return tracks.filter((track) => track.id !== action.payload.trackId || track.kind === 'master');
        case 'restoreTrack':
            return [...tracks, restoredTrackName(action)];
        default:
            return tracks;
    }
}

// Project only the names the ordered prefix leaves, without running its writes or allocating identities.
// Raw anonymous additions remain separate rows; a compiled prefix keeps its already-pinned names and IDs.
function getTracksPlannedBefore(context: HandlerMaterializationContext | undefined) {
    let planned: PlannedTrackName[] = (getTrackStoreState()?.tracks ?? []).map(({ id, kind, name }) => ({
        id,
        kind,
        name,
    }));
    if (!context) {
        return planned;
    }
    for (const prior of (context.preparedPrefix ?? context.actions).slice(0, context.actionIndex)) {
        planned = projectTrackNames(planned, prior);
    }
    return planned;
}

/** The default name a nameless `addTrack` of `kind` takes at `context`'s position in its batch. */
export function planDefaultTrackName(kind: TrackKind, context?: HandlerMaterializationContext): string {
    return nextDefaultTrackName(kind, getTracksPlannedBefore(context));
}
