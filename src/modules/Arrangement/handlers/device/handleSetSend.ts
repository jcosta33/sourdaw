import { createHandler } from '#/utils/createHandler';

import { getTrackEligibility } from '../../stores/trackEligibility';
import { setSend } from '../../useCases/device/sendManagement/setSend';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export const handleSetSend = createHandler<'setSend'>({
    execute: (alpha) => {
        const state = getTrackStoreState();
        const track = state?.tracks.find((candidate) => candidate.id === alpha.payload.trackId);
        const target = state?.tracks.find((candidate) => candidate.id === alpha.payload.busId);
        if (
            (track && !getTrackEligibility(track.kind).acceptsSend) ||
            (target && !getTrackEligibility(target.kind).acceptsRoutingEndpoint)
        ) {
            if (alpha.payload.expectedLevel !== undefined || alpha.payload.expectedPreFader !== undefined) {
                return { status: 'conflict' };
            }
            return { status: 'no-write' };
        }
        const existing = track?.sends.find((send) => send.busId === alpha.payload.busId);
        if (!existing) {
            return { status: 'conflict' };
        }
        if (
            (alpha.payload.expectedLevel !== undefined && existing.level !== alpha.payload.expectedLevel) ||
            (alpha.payload.expectedPreFader !== undefined && existing.preFader !== alpha.payload.expectedPreFader)
        ) {
            return { status: 'conflict' };
        }
        const runtimeEffect = setSend(
            alpha.payload.trackId,
            alpha.payload.busId,
            alpha.payload.level,
            existing.preFader,
            { deferRuntimeEffect: true }
        );
        if (!runtimeEffect) {
            return { status: 'conflict' };
        }
        return {
            status: 'written',
            afterCommit: runtimeEffect.afterCommit,
            afterAmbiguousCommit: runtimeEffect.afterAmbiguousCommit,
        };
    },
    isNoop: (action) => {
        const existing = getTrackStoreState()
            ?.tracks.find((track) => track.id === action.payload.trackId)
            ?.sends.find((send) => send.busId === action.payload.busId);
        if (!existing) {
            return false;
        }
        if (
            (action.payload.expectedLevel !== undefined && existing.level !== action.payload.expectedLevel) ||
            (action.payload.expectedPreFader !== undefined && existing.preFader !== action.payload.expectedPreFader)
        ) {
            return false;
        }
        return existing.level === action.payload.level;
    },
    describe: (alpha) => {
        const label = 'Set send level';
        const state = getTrackStoreState();
        const track = state?.tracks.find((time) => time.id === alpha.payload.trackId);
        const target = state?.tracks.find((time) => time.id === alpha.payload.busId);
        if (
            !track ||
            !target ||
            !getTrackEligibility(track.kind).acceptsSend ||
            !getTrackEligibility(target.kind).acceptsRoutingEndpoint
        ) {
            return { label, inverseAction: null };
        }
        const existing = track.sends.find((state) => state.busId === alpha.payload.busId);
        if (!existing) {
            return { label, inverseAction: null };
        }
        return {
            label,
            inverseAction: {
                type: 'setSend',
                payload: {
                    trackId: alpha.payload.trackId,
                    busId: alpha.payload.busId,
                    level: existing.level,
                    expectedLevel: alpha.payload.level,
                    expectedPreFader: existing.preFader,
                },
            },
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
