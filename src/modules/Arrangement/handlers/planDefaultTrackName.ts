import { type HandlerMaterializationContext } from '#/utils/handlerContract';

import { nextDefaultTrackName } from '../models/DefaultTrackName';
import { type TrackKind } from '../models/Track';
import { getTrackStoreState } from '../useCases/getTrackStoreState';

import { type PlannedTrackName, projectTrackNames } from './projectTrackNames';

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
