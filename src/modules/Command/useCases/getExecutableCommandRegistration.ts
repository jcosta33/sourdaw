import { getHandlerByType } from '../stores/handlerRegistry';

import { executableAppActionDescriptorByType, type ExecutableAppActionType } from './executableAppActionRegistry';
import { getExecutableCommandConfirmation } from './getExecutableCommandConfirmation';
import { validateVersionedCommandArguments } from './versionedCommandArgumentKeys';

export function getExecutableCommandRegistration<ActionType extends ExecutableAppActionType>(actionType: ActionType) {
    const descriptor = executableAppActionDescriptorByType.get(actionType);
    if (!descriptor) {
        throw new Error(`Executable command is not completely registered: ${actionType}`);
    }
    const confirmation = getExecutableCommandConfirmation(descriptor.risk);
    function getRegisteredHandler() {
        const handler = getHandlerByType(actionType);
        if (!handler) {
            throw new Error(`Executable command is not completely registered: ${actionType}`);
        }
        return handler;
    }

    return {
        actionType,
        providerSchema: descriptor.parameters,
        runtimeSchema: {
            validate: (value: unknown) => validateVersionedCommandArguments(actionType, value),
        },
        toolDescription: descriptor.description,
        intentPhrases: descriptor.intentPhrases,
        selectionPhrases: 'selectionPhrases' in descriptor ? descriptor.selectionPhrases : [],
        directionalIntent: 'directionalIntent' in descriptor ? descriptor.directionalIntent : undefined,
        targetChecks: descriptor.targetRules,
        capabilityChecks: descriptor.targetRules.map(({ argument, capability }) => ({ argument, capability })),
        valueRules: 'valueRules' in descriptor ? descriptor.valueRules : [],
        risk: descriptor.risk,
        confirmation,
        get handler() {
            return getRegisteredHandler();
        },
        get noOpDetector() {
            return getRegisteredHandler().isNoop;
        },
        get inverseOrCompensation() {
            const handler = getRegisteredHandler();
            return {
                undoable: handler.undoable,
                describe: handler.describe,
                prepareAbort: handler.prepareAbort,
                requiresAbortCompensation: handler.requiresAbortCompensation ?? true,
            };
        },
        get receiptDescription() {
            return getRegisteredHandler().describe;
        },
    };
}
