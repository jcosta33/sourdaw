import { type AppAction } from '#/utils/handlerContract';

export const COMMAND_TEMPO_TARGET_ID = '@project/transport/tempo';
export const COMMAND_TIME_SIGNATURE_TARGET_ID = '@project/transport/time-signature';
export const COMMAND_MASTER_GAIN_TARGET_ID = '@project/transport/master-gain';

export function getCommandDivergenceTargetIds(input: {
    actions: readonly AppAction[];
    targetIds: readonly string[];
}): string[] {
    const targetIds = new Set(input.targetIds);
    for (const action of input.actions) {
        if (action.type === 'setTempo') {
            targetIds.add(COMMAND_TEMPO_TARGET_ID);
        } else if (action.type === 'setTimeSignature') {
            targetIds.add(COMMAND_TIME_SIGNATURE_TARGET_ID);
        } else if (action.type === 'setMasterGain' || action.type === 'restoreMasterGain') {
            targetIds.add(COMMAND_MASTER_GAIN_TARGET_ID);
        }
    }
    return [...targetIds];
}
