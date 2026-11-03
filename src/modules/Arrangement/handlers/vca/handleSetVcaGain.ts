import { resolveLevelFields, VCA_LEVEL_LAW } from '#/utils/audioLevelLaw';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { getVcaGroupsState } from '../../stores/vcaGroupStore';
import { captureLegacyVcaState } from '../../useCases/vca/captureLegacyVcaState';
import { setVcaGain } from '../../useCases/vca/setVcaGain';

import { toVcaGainExecutionResult } from './toVcaGainExecutionResult';

type Action = Extract<AppAction, { type: 'setVcaGain' }>;

function requestedGain(action: Action, current: number) {
    return resolveLevelFields(
        { linear: action.payload.gain, absoluteDb: action.payload.gainDb, deltaDb: action.payload.deltaDb },
        current,
        VCA_LEVEL_LAW
    );
}

export const handleSetVcaGain = createHandler<'setVcaGain'>({
    batchExecution: 'singleton',
    validate: (action) => {
        const group = getVcaGroupsState().find((candidate) => candidate.id === action.payload.vcaGroupId);
        return !group || requestedGain(action, group.gain).ok;
    },
    execute: (action) => {
        const group = getVcaGroupsState().find((candidate) => candidate.id === action.payload.vcaGroupId);
        if (!group) {
            return toVcaGainExecutionResult({ groupIds: [action.payload.vcaGroupId], status: 'no-write' });
        }
        const requested = requestedGain(action, group.gain);
        if (!requested.ok) {
            return { status: 'conflict', reason: requested.reason };
        }
        const written = setVcaGain(action.payload.vcaGroupId, requested.linear);
        return toVcaGainExecutionResult({
            groupIds: [action.payload.vcaGroupId],
            status: written ? 'written' : 'no-write',
        });
    },
    describe: (action) => {
        const group = getVcaGroupsState().find((candidate) => candidate.id === action.payload.vcaGroupId);
        if (!group) {
            return { label: 'Set VCA Gain', inverseAction: null };
        }
        const requested = requestedGain(action, group.gain);
        if (!requested.ok) {
            return { label: 'Set VCA Gain', inverseAction: null };
        }
        const linearAction: Action = {
            type: 'setVcaGain',
            payload: { vcaGroupId: action.payload.vcaGroupId, gain: requested.linear },
        };
        const inversePayload = captureLegacyVcaState(linearAction);
        const redoPayload = captureLegacyVcaState({ type: 'restoreLegacyVcaState', payload: inversePayload });
        return {
            label: 'Set VCA Gain',
            inverseAction: { type: 'restoreLegacyVcaState', payload: inversePayload },
            redoAction: { type: 'restoreLegacyVcaState', payload: redoPayload },
        };
    },
    isNoop: (action) => {
        const group = getVcaGroupsState().find((candidate) => candidate.id === action.payload.vcaGroupId);
        if (!group) {
            return false;
        }
        const requested = requestedGain(action, group.gain);
        return requested.ok && group.gain === requested.linear;
    },
    undoable: true,
});
