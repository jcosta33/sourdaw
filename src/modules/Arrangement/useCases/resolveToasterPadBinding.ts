import type { Track } from '../stores/trackStore';

export function resolveToasterPadBinding(tracks: readonly Track[], trackId: string) {
    const track = tracks.find((candidate) => candidate.id === trackId);
    if (!track?.parentId) {
        return undefined;
    }
    const parent = tracks.find((candidate) => candidate.id === track.parentId);
    if (!parent?.devices.some((device) => device.type === 'toaster')) {
        return undefined;
    }
    const padIndex = tracks
        .filter((candidate) => candidate.parentId === parent.id)
        .findIndex((candidate) => candidate.id === trackId);
    if (padIndex < 0 || padIndex >= 16) {
        return undefined;
    }
    return { toasterParentTrackId: parent.id, padIndex };
}
