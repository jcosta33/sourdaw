import { type ProjectContext } from '../../models/ProjectContext';

/** The track's name as a reason states it, or its id when the project no longer holds it. */
export function trackName(id: string, context: ProjectContext): string {
    return context.tracks.find((track) => track.id === id)?.name ?? id;
}
