import { createHandler } from '#/utils/createHandler';

import { removeSend } from '../../useCases/device/sendManagement/removeSend';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export const handleRemoveSend = createHandler<'removeSend'>({
    validate: (action) => {
        const existing = getTrackStoreState()
            ?.tracks.find((track) => track.id === action.payload.trackId)
            ?.sends.find((send) => send.busId === action.payload.busId);
        return (
            (action.payload.expectedLevel === undefined || existing?.level === action.payload.expectedLevel) &&
            (action.payload.expectedPreFader === undefined || existing?.preFader === action.payload.expectedPreFader)
        );
    },
    execute: (alpha) => {
        const existing = getTrackStoreState()
            ?.tracks.find((track) => track.id === alpha.payload.trackId)
            ?.sends.find((send) => send.busId === alpha.payload.busId);
        if (
            (alpha.payload.expectedLevel !== undefined && existing?.level !== alpha.payload.expectedLevel) ||
            (alpha.payload.expectedPreFader !== undefined && existing?.preFader !== alpha.payload.expectedPreFader)
        ) {
            return { status: 'conflict' };
        }
        const runtimeEffect = removeSend(alpha.payload.trackId, alpha.payload.busId, {
            deferRuntimeEffect: true,
        });
        if (!runtimeEffect) {
            return { status: 'conflict' };
        }
        return {
            status: 'written',
            afterCommit: runtimeEffect.afterCommit,
            afterAmbiguousCommit: runtimeEffect.afterAmbiguousCommit,
        };
    },
    describe: (alpha) => {
        const existing = getTrackStoreState()
            ?.tracks.find((time) => time.id === alpha.payload.trackId)
            ?.sends.find((state) => state.busId === alpha.payload.busId);
        return {
            label: 'Remove send',
            inverseAction: existing
                ? {
                      type: 'addSend',
                      payload: {
                          trackId: alpha.payload.trackId,
                          busId: alpha.payload.busId,
                          level: existing.level,
                          preFader: existing.preFader,
                          expectedAbsent: true,
                      },
                  }
                : null,
        };
    },
    requiresAbortCompensation: false,
    undoable: true,
});
