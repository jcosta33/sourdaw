/**
 * Group comping store — multi-track comp groups.
 * Extracted from groupCompingUseCases.ts.
 */
import { createStore } from '#/infra/store/createStore';

export type CompGroupEntry = {
    id: string;
    name: string;
    trackIds: string[];
    takeSets: CompTakeSet[];
    activeTakeSetId: string | null;
    compRegions: GroupCompRegion[];
    createdAt: string;
};

export type CompTakeSet = {
    id: string;
    name: string;
    pass: number;
    color: string;
    recordedAt: string;
};

export type GroupCompRegion = {
    id: string;
    startBeat: number;
    endBeat: number;
    takeSetId: string;
    crossfadeBeats: number;
};

export type GroupCompingState = {
    groups: CompGroupEntry[];
    activeGroupId: string | null;
    defaultCrossfade: number;
};

export const groupCompingStore = createStore<GroupCompingState>({
    initialData: { groups: [], activeGroupId: null, defaultCrossfade: 0.125 },
});

// §122.1 — UUID instead of module-level counters that reset on HMR
// and collide across sequential creates after a reload.
export function getNextGroupId(): string {
    return `grp-${crypto.randomUUID()}`;
}
export function getNextTakeSetId(): string {
    return `ts-${crypto.randomUUID()}`;
}
export function getNextRegionId(): string {
    return `gr-${crypto.randomUUID()}`;
}

export const GROUP_COLORS = [
    'oklch(0.42 0.10 150)',
    'oklch(0.42 0.10 210)',
    'oklch(0.42 0.10 290)',
    'oklch(0.42 0.10 340)',
    'oklch(0.42 0.10 50)',
    'oklch(0.42 0.10 80)',
];
