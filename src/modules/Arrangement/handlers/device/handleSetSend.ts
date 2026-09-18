import { type LevelResolution, resolveSendLevelFields } from '#/utils/audioLevelLaw';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { getTrackEligibility } from '../../stores/trackEligibility';
import { setSend } from '../../useCases/device/sendManagement/setSend';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

type SetSendAction = Extract<AppAction, { type: 'setSend' }>;

/** The linear amplitude this action asks for, whichever way it asked; the
 *  decibel forms resolve against the send's live level. */
function requestedLevel(action: SetSendAction, currentLevel: number): LevelResolution {
    return resolveSendLevelFields(action.payload, currentLevel);
}

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
        const requested = requestedLevel(alpha, existing.level);
        if (!requested.ok) {
            return { status: 'conflict', reason: requested.reason };
        }
        const runtimeEffect = setSend(alpha.payload.trackId, alpha.payload.busId, requested.linear, existing.preFader, {
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
        const requested = requestedLevel(action, existing.level);
        return requested.ok && existing.level === requested.linear;
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
        // The inverse puts back the stored amplitude and expects the one this
        // action is about to write, so it refuses rather than clobbering a level
        // something else moved. Both are stated linearly whatever form the
        // forward action used.
        const requested = requestedLevel(alpha, existing.level);
        if (!requested.ok) {
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
                    expectedLevel: requested.linear,
                    expectedPreFader: existing.preFader,
                },
            },
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
