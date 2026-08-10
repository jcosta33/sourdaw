export type BackingVocalPlateProviderCall = {
    name: string;
    arguments: Record<string, unknown>;
};

export type BackingVocalPlateCapability = {
    schemaVersion: 1;
    baseRevision: string;
    backingVocals: Array<{
        trackId: string;
        trackName: string;
        removableReverbDeviceIds: string[];
    }>;
    protectedObjects: Array<{ id: string; name: string }>;
    chorusSections: Array<{
        sectionId: string;
        sectionName: string;
        startBeat: number;
        endBeat: number;
        automationStartBeat: number;
    }>;
    fixedValues: {
        busName: string;
        filterDeviceType: 'builtin-filter';
        filterType: 1;
        highPassHz: 250;
        plateDeviceType: 'dutch-oven';
        sendLevelDb: -18;
        sendLevel: number;
        sendPreFader: false;
        automationTailBars: 4;
        automationTargetLevelDb: -10;
        renderSampleRate: 44_100;
        renderTailSeconds: 0;
    };
    orderedToolPlan: BackingVocalPlateProviderCall[];
};
