import { type DrumRoutingRole } from './DrumRoutingCapability';

export type DrumRenderComparisonProviderCall = {
    name: string;
    arguments: Record<string, unknown>;
};

export type DrumRenderComparisonCapability = {
    schemaVersion: 1;
    baseRevision: string;
    closeDrums: Array<{
        trackId: string;
        trackName: string;
        role: DrumRoutingRole;
        currentOutputId: string;
    }>;
    protectedObjects: Array<{ id: string; name: string }>;
    room: {
        trackId: string;
        trackName: string;
        currentOutputId: 'master';
    };
    renderSections: Array<{
        sectionId: string;
        sectionName: string;
        startBeat: number;
        endBeat: number;
    }>;
    fixedValues: {
        drumBusName: 'Drum Bus';
        drumBusBinding: 'drum-bus';
        parallelBusName: 'Parallel Compression';
        parallelBusBinding: 'parallel-compression';
        compressorDeviceType: 'builtin-compressor';
        sendLevelDb: -12;
        sendLevel: number;
        sendPreFader: false;
        parallelGainDb: -1.5;
        parallelGain: number;
        renderSampleRate: 44_100;
        renderTailSeconds: 0;
    };
    orderedToolPlan: DrumRenderComparisonProviderCall[];
};
