// Clips launch on user tracks. Folders only group tracks and the master bus
// carries no clips, so neither is a launcher column.
export function getLaunchableTracks<TTrack extends { readonly kind?: string }>(tracks: readonly TTrack[]): TTrack[] {
    return tracks.filter((track) => track.kind !== 'master' && track.kind !== 'folder');
}
