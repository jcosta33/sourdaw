import { getHandlerByType } from '../stores/handlerRegistry';

import { executableAppActionDescriptorByType, type ExecutableAppActionType } from './executableAppActionRegistry';
import { getAppActionExecutionPolicy } from './getAppActionExecutionPolicy';

export function getExecutableCommandRegistration<ActionType extends ExecutableAppActionType>(actionType: ActionType) {
    const descriptor = executableAppActionDescriptorByType.get(actionType);
    if (!descriptor) {
        throw new Error(`Executable command is not completely registered: ${actionType}`);
    }
    const handler = getHandlerByType(actionType);
    if (!handler) {
        throw new Error(`Executable command is not completely registered: ${actionType}`);
    }
    const policy = getAppActionExecutionPolicy(actionType);

    return {
        actionType,
        runtimeSchema: descriptor.parameters,
        toolDescription: descriptor.description,
        targetChecks: descriptor.targetRules,
        capabilityChecks: descriptor.targetRules.map(({ argument, capability }) => ({ argument, capability })),
        risk: descriptor.risk,
        confirmation: {
            required: policy.requiresConfirmation,
            reason: policy.reason,
        },
        handler,
        noOpDetector: handler.isNoop,
        inverseOrCompensation: {
            undoable: handler.undoable,
            describe: handler.describe,
            prepareAbort: handler.prepareAbort,
            requiresAbortCompensation: handler.requiresAbortCompensation ?? true,
        },
        receiptDescription: handler.describe,
    };
}
