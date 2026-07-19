import { type Track } from '../../stores/trackStore';

export function migrateLegacyFrozenTrackStates(tracks: readonly Track[]): Track[] {
    return tracks.map((track) => {
        if (
            track.freezeState.status !== 'frozen' ||
            (track.freezeState.sourceContentHash?.startsWith('freeze-v2:') === true &&
                typeof track.freezeState.adjustmentLayerSignature === 'string')
        ) {
            return track;
        }
        return {
            ...track,
            freezeState: {
                ...track.freezeState,
                status: 'stale' as const,
            },
        };
    });
}
