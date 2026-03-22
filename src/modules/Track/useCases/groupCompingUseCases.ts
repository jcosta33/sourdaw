/**
 * Multi-track Group Comping
 *
 * Extends the existing single-track take lane system to support
 * multi-track comp groups — e.g., selecting the best drum take
 * across all drum mic tracks simultaneously via swipe comping.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type CompGroupEntry = {
    id: string;
    name: string;
    /** All track IDs in this comp group (e.g., kick + snare + overheads) */
    trackIds: string[];
    /** Available multi-track take sets */
    takeSets: CompTakeSet[];
    /** Active take set ID */
    activeTakeSetId: string | null;
    /** Comp regions override the active take per region */
    compRegions: GroupCompRegion[];
    createdAt: string;
};

export type CompTakeSet = {
    id: string;
    name: string;
    /** Pass number */
    pass: number;
    color: string;
    recordedAt: string;
};

export type GroupCompRegion = {
    id: string;
    startBeat: number;
    endBeat: number;
    /** Which take set to use for this region */
    takeSetId: string;
    crossfadeBeats: number;
};

export type GroupCompingState = {
    groups: CompGroupEntry[];
    activeGroupId: string | null;
    defaultCrossfade: number;
};

export const groupCompingStore = new Store<GroupCompingState>(logger, {
    initialData: { groups: [], activeGroupId: null, defaultCrossfade: 0.125 },
});

let groupId = 1;
let takeSetId = 1;
let regionId = 1;

const GROUP_COLORS = [
    'oklch(0.70 0.14 150)', 'oklch(0.70 0.14 210)', 'oklch(0.70 0.14 290)',
    'oklch(0.70 0.14 340)', 'oklch(0.70 0.14 50)', 'oklch(0.70 0.14 80)',
];

export function createCompGroup(name: string, trackIds: string[]): void {
    const state = groupCompingStore.value;
    if (!state) {
        return;
    }
    const group: CompGroupEntry = {
        id: `grp-${groupId++}`, name, trackIds, takeSets: [],
        activeTakeSetId: null, compRegions: [], createdAt: new Date().toISOString(),
    };
    groupCompingStore.set({ ...state, groups: [...state.groups, group], activeGroupId: group.id });
}

export function addGroupTakeSet(grpId: string, name: string): void {
    const state = groupCompingStore.value;
    if (!state) {
        return;
    }
    groupCompingStore.set({
        ...state,
        groups: state.groups.map((g) => {
            if (g.id !== grpId) {
                return g;
            }
            const ts: CompTakeSet = {
                id: `ts-${takeSetId++}`, name, pass: g.takeSets.length + 1,
                color: GROUP_COLORS[g.takeSets.length % GROUP_COLORS.length]!,
                recordedAt: new Date().toISOString(),
            };
            return {
                ...g, takeSets: [...g.takeSets, ts],
                activeTakeSetId: g.activeTakeSetId ?? ts.id,
            };
        }),
    });
}

export function swipeGroupComp(grpId: string, takeSetIdVal: string, startBeat: number, endBeat: number): void {
    const state = groupCompingStore.value;
    if (!state) {
        return;
    }
    const region: GroupCompRegion = {
        id: `gr-${regionId++}`, startBeat, endBeat, takeSetId: takeSetIdVal,
        crossfadeBeats: state.defaultCrossfade,
    };
    groupCompingStore.set({
        ...state,
        groups: state.groups.map((g) => {
            if (g.id !== grpId) {
                return g;
            }
            const cleaned = g.compRegions.filter((r) => r.endBeat <= startBeat || r.startBeat >= endBeat);
            return { ...g, compRegions: [...cleaned, region].sort((a, b) => a.startBeat - b.startBeat) };
        }),
    });
}

export function setActiveGroupTakeSet(grpId: string, tsId: string): void {
    const state = groupCompingStore.value;
    if (!state) {
        return;
    }
    groupCompingStore.set({
        ...state,
        groups: state.groups.map((g) => g.id === grpId ? { ...g, activeTakeSetId: tsId } : g),
    });
}

export function deleteCompGroup(grpId: string): void {
    const state = groupCompingStore.value;
    if (!state) {
        return;
    }
    groupCompingStore.set({
        ...state,
        groups: state.groups.filter((g) => g.id !== grpId),
        activeGroupId: state.activeGroupId === grpId ? null : state.activeGroupId,
    });
}
