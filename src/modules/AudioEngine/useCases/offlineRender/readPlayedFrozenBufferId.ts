import { type Track } from '#/modules/Arrangement/stores';

/** The frozen take an offline render plays in place of the track's clips and chain, or null when it plays them. */
export function readPlayedFrozenBufferId(track: Track): string | null {
    if (track.freezeState.status === 'frozen' && track.freezeState.frozenBufferId) {
        return track.freezeState.frozenBufferId;
    }
    return null;
}
