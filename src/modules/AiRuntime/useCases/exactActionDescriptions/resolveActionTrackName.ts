import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

/** The name of a track in the snapshot or of a bus the same batch creates, else its id. */
export function resolveActionTrackName(
    trackId: string,
    actions: readonly AppAction[],
    context: ProjectContext
): string {
    const existing = context.tracks.find((track) => track.id === trackId);
    if (existing) {
        return existing.name;
    }
    const created = actions.find((action) => action.type === 'createBus' && action.payload.busId === trackId);
    return created?.type === 'createBus' ? created.payload.name : trackId;
}
