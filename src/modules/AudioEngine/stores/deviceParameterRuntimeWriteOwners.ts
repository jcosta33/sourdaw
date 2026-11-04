export const deviceParameterRuntimeWriteOwners = new Map<string, Map<string, Map<string, symbol>>>();

export const pendingDeviceParameterRuntimeWriteOwners = new Map<string, Set<symbol>>();
export const deviceParameterRuntimeWriteSequences = new Map<string, number>();

export const deviceParameterRuntimeWriteContexts: {
    trackId: string;
    deviceId: string;
    paramId: string;
    owner: symbol | undefined;
}[] = [];
export const deviceParameterRuntimeWriteCounter = { nextWrite: 0 };
