import { type FreezeStateSnapshot } from '#/utils/handlerContract';

import { type Track } from '../../stores/trackStore';

/**
 * Identity comparison for a guarded freeze restore. Compares what identifies *which*
 * take a track carries — the status and the two buffer pointers — rather than the whole
 * aggregate: `renderProgress` ticks during a render and the derived hashes are recomputed,
 * so a deep equality here would report a conflict against state nothing meaningfully
 * changed.
 */
export function freezeStateSnapshotMatches(track: Track, expected: FreezeStateSnapshot): boolean {
    return (
        track.frozen === expected.frozen &&
        track.frozenBufferId === expected.frozenBufferId &&
        track.freezeState.status === expected.freezeState.status &&
        track.freezeState.freezeId === expected.freezeState.freezeId &&
        track.freezeState.frozenBufferId === expected.freezeState.frozenBufferId
    );
}
