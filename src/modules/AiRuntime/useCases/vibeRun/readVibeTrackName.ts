import { type ProjectContext } from '../../models/ProjectContext';

/** A track as a card names it; an id the project no longer holds stands for itself. */
export function readVibeTrackName(context: ProjectContext, trackId: string): string {
    return context.tracks.find((track) => track.id === trackId)?.name ?? trackId;
}
