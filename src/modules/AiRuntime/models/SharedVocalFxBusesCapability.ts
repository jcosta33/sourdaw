export type SharedVocalFxProviderCall = {
    name: string;
    arguments: Record<string, unknown>;
};

export type SharedVocalFxEffectGroup = {
    kind: 'delay' | 'reverb';
    busName: string;
    binding: string;
    deviceType: 'builtin-delay' | 'builtin-reverb';
    mixParameterId: 'delay-mix' | 'rev-mix';
    sharedParameterValues: Array<{
        parameterId: string;
        parameterName: string;
        value: number;
        unit: string;
    }>;
    sources: Array<{
        trackId: string;
        trackName: string;
        deviceId: string;
        deviceName: string;
        originalGain: number;
        targetGain: number;
        originalMix: number;
        sendLevel: number;
        preFader: false;
    }>;
};

export type SharedVocalFxBusesCapability = {
    schemaVersion: 1;
    baseRevision: string;
    effectGroups: [SharedVocalFxEffectGroup, SharedVocalFxEffectGroup];
    protectedObjects: Array<{ id: string; name: string }>;
    orderedToolPlan: SharedVocalFxProviderCall[];
};
