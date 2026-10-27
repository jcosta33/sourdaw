export const deviceParameterRuntimeWriteOwners = new Map<string, Map<string, Map<string, symbol>>>();

export const pendingDeviceParameterRuntimeWriteOwners = new Map<string, Set<symbol>>();
export const deviceParameterRuntimeWriteSequences = new Map<string, number>();
