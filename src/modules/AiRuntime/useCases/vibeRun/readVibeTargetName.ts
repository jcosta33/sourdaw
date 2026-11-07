import { type ProjectContext } from '../../models/ProjectContext';

/** A batch target as a card names it: the track's name, or the master output. */
export function readVibeTargetName(context: Pick<ProjectContext, 'tracks'>, targetId: string): string {
    if (targetId === 'master') {
        return 'the master output';
    }
    return context.tracks.find((track) => track.id === targetId)?.name ?? targetId;
}
