type BassProcessingSectionSummary = {
    id: string;
    name: string;
    startBeat: number;
    endBeat: number;
};

type BassProcessingRegionSummary = {
    id: string;
    startBeat: number;
    endBeat: number;
    blend: number;
    fadeInBeats: number;
    fadeOutBeats: number;
};

export type BassProcessingCopyCapability = {
    schemaVersion: 1;
    baseRevision: string;
    actionType: 'addAdjustmentRegion';
    sourceSection: BassProcessingSectionSummary;
    targetSection: BassProcessingSectionSummary;
    bassTracks: Array<{ id: string; name: string }>;
    sourceProcessing: Array<{
        layerId: string;
        layerName: string;
        effectType: string;
        affectedTrackIds: string[];
        enabled: boolean;
        mix: number;
        parameters: Array<{ name: string; value: number; unit: string }>;
        sourceRegion: BassProcessingRegionSummary;
        targetRegion: Omit<BassProcessingRegionSummary, 'id'>;
    }>;
    exactPlan: Array<{
        layerId: string;
        startBeat: number;
        endBeat: number;
        blend: number;
        fadeInBeats: number;
        fadeOutBeats: number;
    }>;
    protectedAutomationLanes: Array<{
        id: string;
        trackId: string;
        parameterId: string;
        name: string;
        enabled: boolean;
        points: Array<{ beat: number; value: number; curve: string }>;
    }>;
    protectedObjectIds: string[];
    constraints: {
        preserveSourceProcessing: true;
        preserveTargetDistortionAutomation: true;
        requireFreshConfirmation: true;
    };
};
