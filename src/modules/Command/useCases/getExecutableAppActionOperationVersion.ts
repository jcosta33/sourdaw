import { executableAppActionDescriptorByType, type ExecutableAppActionType } from './executableAppActionRegistry';

export function getExecutableAppActionOperationVersion(actionType: ExecutableAppActionType): number {
    const descriptor = executableAppActionDescriptorByType.get(actionType);
    if (!descriptor) {
        throw new Error(`Executable command is not completely registered: ${actionType}`);
    }
    const operationVersion =
        'operationVersion' in descriptor && typeof descriptor.operationVersion === 'number'
            ? descriptor.operationVersion
            : 1;
    if (!Number.isSafeInteger(operationVersion) || operationVersion < 1) {
        throw new Error(`Executable command has an invalid operation version: ${actionType}`);
    }
    return operationVersion;
}
