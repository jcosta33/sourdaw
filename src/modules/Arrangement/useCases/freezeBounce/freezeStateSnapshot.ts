import { type FreezeStateSnapshot } from '#/utils/handlerContract';

import { type Track } from '../../stores/trackStore';

/** The state `unfreezeTrack` leaves behind. Named once so the freeze handlers guard
 *  against the same shape the use case actually writes. */
export const UNFROZEN_SNAPSHOT: FreezeStateSnapshot = {
    frozen: false,
    freezeState: { status: 'unfrozen' },
};

export function captureFreezeStateSnapshot(track: Track): FreezeStateSnapshot {
    return {
        frozen: track.frozen,
        ...(track.frozenBufferId === undefined ? {} : { frozenBufferId: track.frozenBufferId }),
        freezeState: {
            ...track.freezeState,
            ...(track.freezeState.renderSettings === undefined
                ? {}
                : { renderSettings: { ...track.freezeState.renderSettings } }),
        },
    };
}
