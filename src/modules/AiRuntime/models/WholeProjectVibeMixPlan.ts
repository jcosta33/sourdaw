import { type ExecutableRuntimeAction } from './ExecutableRuntimeAction';

export type WholeProjectVibeMixPlan = {
    schemaVersion: 1;
    baseRevision: string;
    productionVision: string;
    globalConstraints: Array<{ id: string; name: string; reason: string }>;
    sectionMap: {
        target: { id: string; name: string; startBeat: number; endBeat: number };
        previous: { id: string; name: string; startBeat: number; endBeat: number } | null;
        next: { id: string; name: string; startBeat: number; endBeat: number } | null;
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
