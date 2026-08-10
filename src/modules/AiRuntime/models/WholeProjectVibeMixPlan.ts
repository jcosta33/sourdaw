import { type ExecutableRuntimeAction } from './ExecutableRuntimeAction';

type WholeProjectVibeMixSectionSummary = {
    id: string;
    name: string;
    startBeat: number;
    endBeat: number;
};

export type WholeProjectVibeMixCapability = {
    schemaVersion: 1;
    baseRevision: string;
    actionType: 'automateTrackGainRange';
    targetSection: WholeProjectVibeMixSectionSummary;
    neighboringSections: {
        previous: WholeProjectVibeMixSectionSummary | null;
        next: WholeProjectVibeMixSectionSummary | null;
    };
    candidateImpactBuses: Array<{ id: string; name: string; currentGain: number }>;
    exactTargetIds: string[];
    allowedRelativeGainDbValues: [number];
    protectedObjectIds: string[];
    constraints: {
        preserveRouting: true;
        preserveDevices: true;
        requireFreshConfirmation: true;
    };
};

export type WholeProjectVibeMixPlan = {
    schemaVersion: 1;
    baseRevision: string;
    productionVision: string;
    globalConstraints: Array<{ id: string; name: string; reason: string }>;
    sectionMap: {
        target: WholeProjectVibeMixSectionSummary;
        previous: WholeProjectVibeMixSectionSummary | null;
        next: WholeProjectVibeMixSectionSummary | null;
    };
    trackRoles: Array<{
        trackId: string;
        trackName: string;
        role: 'impact-bus' | 'protected-lead-vocal' | 'protected-master';
    }>;
    dynamicTrajectory: {
        gainDb: number;
        startBeat: number;
        endBeat: number;
        before: 'preserve-current';
        inside: 'lift-impact-buses';
        after: 'restore-current';
    };
    strategy: {
        routing: 'preserve-existing';
        devices: 'preserve-existing';
        automation: string;
    };
    acceptedDecisions: string[];
    commandBatch: ExecutableRuntimeAction[];
};
