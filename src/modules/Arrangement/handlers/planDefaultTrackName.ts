import { type HandlerMaterializationContext } from '#/utils/handlerContract';

import { nextDefaultTrackName } from '../models/DefaultTrackName';
import { type TrackKind } from '../models/Track';
import { getTrackStoreState } from '../useCases/getTrackStoreState';

// The tracks a batch creates before this action, named as they will be named,
// so two nameless creations in one batch never resolve to the same default.
// Command passes the already-materialized prefix; a caller compiling envelopes
// from its raw plan passes only `actions`, and its nameless prefix is named here
// by the same rule, against the same project.
function getTracksPlannedBefore(context: HandlerMaterializationContext | undefined) {
    const planned = (getTrackStoreState()?.tracks ?? []).map(({ kind, name }) => ({ kind, name }));
    if (!context) {
        return planned;
    }
    for (const prior of (context.preparedPrefix ?? context.actions).slice(0, context.actionIndex)) {
        if (prior.type === 'addTrack') {
            planned.push({
                kind: prior.payload.kind,
                name: prior.payload.name ?? nextDefaultTrackName(prior.payload.kind, planned),
            });
        } else if (prior.type === 'createBus') {
            planned.push({ kind: 'bus', name: prior.payload.name });
        }
    }
    return planned;
}

/** The default name a nameless `addTrack` of `kind` takes at `context`'s position in its batch. */
export function planDefaultTrackName(kind: TrackKind, context?: HandlerMaterializationContext): string {
    return nextDefaultTrackName(kind, getTracksPlannedBefore(context));
}
