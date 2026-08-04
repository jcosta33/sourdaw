import { createHandler } from '#/utils/createHandler';

import { getVcaGroupsState } from '../../stores/vcaGroupStore';
import { captureLegacyVcaState } from '../../useCases/vca/captureLegacyVcaState';
import { setVcaGain } from '../../useCases/vca/setVcaGain';

import { toVcaGainExecutionResult } from './toVcaGainExecutionResult';

export const handleSetVcaGain = createHandler<'setVcaGain'>({
    execute: (alpha) => {
        const written = setVcaGain(alpha.payload.vcaGroupId, alpha.payload.gain);
        return toVcaGainExecutionResult({
            groupIds: [alpha.payload.vcaGroupId],
            status: written ? 'written' : 'no-write',
        });
    },
    describe: (alpha) => {
        const inversePayload = captureLegacyVcaState(alpha);
        const redoPayload = captureLegacyVcaState({ type: 'restoreLegacyVcaState', payload: inversePayload });
        return {
            label: 'Set VCA Gain',
            inverseAction: { type: 'restoreLegacyVcaState', payload: inversePayload },
            redoAction: { type: 'restoreLegacyVcaState', payload: redoPayload },
        };
    },
    isNoop: (alpha) =>
        getVcaGroupsState().some((group) => group.id === alpha.payload.vcaGroupId && group.gain === alpha.payload.gain),
    undoable: true,
});
