import { inject } from '#/infra/di/inject';
import {
    groupCompingStore,
    getNextGroupId,
    getNextTakeSetId,
    getNextRegionId,
    GROUP_COLORS,
    type CompGroupEntry,
    type CompTakeSet,
    type GroupCompRegion,
} from '#/modules/Arrangement/stores/groupComping';

export const compGroupOperationsDependencies = {
    groupCompingStore,
    getNextGroupId,
    getNextTakeSetId,
    getNextRegionId,
    GROUP_COLORS,
} as const;

export const createCompGroup = inject(compGroupOperationsDependencies)(
    ({ groupCompingStore, getNextGroupId }) =>
        function createCompGroup(name: string, trackIds: string[]): void {
            const state = groupCompingStore.value;
            if (!state) {
                return;
            }
            const group: CompGroupEntry = {
                id: getNextGroupId(),
                name,
                trackIds,
                takeSets: [],
                activeTakeSetId: null,
                compRegions: [],
                createdAt: new Date().toISOString(),
            };
            groupCompingStore.set({ ...state, groups: [...state.groups, group], activeGroupId: group.id });
        }
);

export const addGroupTakeSet = inject(compGroupOperationsDependencies)(
    ({ groupCompingStore, getNextTakeSetId, GROUP_COLORS }) =>
        function addGroupTakeSet(grpId: string, name: string): void {
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
                        id: getNextTakeSetId(),
                        name,
                        pass: g.takeSets.length + 1,
                        color: GROUP_COLORS[g.takeSets.length % GROUP_COLORS.length]!,
                        recordedAt: new Date().toISOString(),
                    };
                    return {
                        ...g,
                        takeSets: [...g.takeSets, ts],
                        activeTakeSetId: g.activeTakeSetId ?? ts.id,
                    };
                }),
            });
        }
);

export const swipeGroupComp = inject(compGroupOperationsDependencies)(
    ({ groupCompingStore, getNextRegionId }) =>
        function swipeGroupComp(grpId: string, takeSetIdVal: string, startBeat: number, endBeat: number): void {
            const state = groupCompingStore.value;
            if (!state) {
                return;
            }
            const region: GroupCompRegion = {
                id: getNextRegionId(),
                startBeat,
                endBeat,
                takeSetId: takeSetIdVal,
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
);

export const setActiveGroupTakeSet = inject(compGroupOperationsDependencies)(
    ({ groupCompingStore }) =>
        function setActiveGroupTakeSet(grpId: string, tsId: string): void {
            const state = groupCompingStore.value;
            if (!state) {
                return;
            }
            groupCompingStore.set({
                ...state,
                groups: state.groups.map((g) => (g.id === grpId ? { ...g, activeTakeSetId: tsId } : g)),
            });
        }
);

export const deleteCompGroup = inject(compGroupOperationsDependencies)(
    ({ groupCompingStore }) =>
        function deleteCompGroup(grpId: string): void {
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
);
