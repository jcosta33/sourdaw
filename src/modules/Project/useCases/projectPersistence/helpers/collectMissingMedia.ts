import { type Track } from '#/modules/Arrangement/stores';

import { type MissingMediaItem } from '../../../stores/missingMediaStore';

export function collectMissingMedia(
    tracks: readonly Track[],
    hasBuffer: (bufferId: string) => boolean
): MissingMediaItem[] {
    const items: MissingMediaItem[] = [];
    for (const track of tracks) {
        for (const clip of track.clips) {
            if (clip.type !== 'audio' || !clip.audioBufferId) {
                continue;
            }
            if (hasBuffer(clip.audioBufferId)) {
                continue;
            }
            items.push({
                bufferId: clip.audioBufferId,
                clipId: clip.id,
                kind: 'clip',
                label: clip.name,
                trackId: track.id,
                trackName: track.name,
            });
        }

        if (track.freezeState.status !== 'frozen' || !track.freezeState.frozenBufferId) {
            continue;
        }
        if (hasBuffer(track.freezeState.frozenBufferId)) {
            continue;
        }
        items.push({
            bufferId: track.freezeState.frozenBufferId,
            kind: 'frozenTrack',
            label: `Frozen track ${track.name}`,
            trackId: track.id,
            trackName: track.name,
        });
    }
    return items;
}
