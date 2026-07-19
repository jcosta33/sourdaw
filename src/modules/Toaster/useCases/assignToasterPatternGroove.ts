import { getScopedGrooveConsumerId } from '#/modules/MIDI/useCases';

import { toasterGrooveAssignmentExecutorState } from './toasterGrooveAssignmentExecutorState';

type AssignToasterPatternGrooveInput = {
    deviceId: string;
    patternId: string;
    templateId: string;
    amount: number;
};

export function assignToasterPatternGroove({
    deviceId,
    patternId,
    templateId,
    amount,
}: AssignToasterPatternGrooveInput): Promise<void> {
    return toasterGrooveAssignmentExecutorState.execute({
        type: 'assignGrooveTemplate',
        payload: {
            consumerType: 'toaster-pattern',
            consumerId: getScopedGrooveConsumerId({ ownerId: deviceId, localId: patternId }),
            templateId,
            amount,
        },
    });
}
