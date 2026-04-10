import { wireSidechainRoute, unwireSidechainRoute } from '#/modules/AudioEngine';

import { sidechainStore } from '../stores/sidechainStore';
import { SidechainCycleError } from '../errors/RoutingErrors';

export type SidechainRoute = {
    id: string;
    sourceTrackId: string;
    targetTrackId: string;
    targetDeviceId: string;
    targetParameterId: string;
    gain: number;
};

let nextSidechainId = 1;

function createSidechainRoute(
    sourceTrackId: string,
    targetTrackId: string,
    targetDeviceId: string,
    targetParameterId: string = 'threshold',
    gain: number = 1
): SidechainRoute {
    return {
        id: `sidechain-${nextSidechainId++}`,
        sourceTrackId,
        targetTrackId,
        targetDeviceId,
        targetParameterId,
        gain,
    };
}

export function addSidechainRoute(
    sourceTrackId: string,
    targetTrackId: string,
    targetDeviceId: string,
    targetParameterId = 'threshold'
): void {
    const state = sidechainStore.value;
    if (!state) {
        return;
    }

    const exists = state.routes.some((r) => r.sourceTrackId === sourceTrackId && r.targetDeviceId === targetDeviceId);
    if (exists) {
        return;
    }

    if (wouldCreateCycle(sourceTrackId, targetTrackId, state.routes)) {
        throw new SidechainCycleError(sourceTrackId, targetTrackId);
    }

    const route = createSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId, targetParameterId);
    sidechainStore.set({ routes: [...state.routes, route] });

    wireSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId);
}

function wouldCreateCycle(sourceTrackId: string, targetTrackId: string, routes: SidechainRoute[]): boolean {
    if (sourceTrackId === targetTrackId) {
        return true;
    }
    const visited = new Set<string>();
    const queue = [targetTrackId];
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === sourceTrackId) {
            return true;
        }
        if (visited.has(current)) {
            continue;
        }
        visited.add(current);
        for (const route of routes) {
            if (route.sourceTrackId === current) {
                queue.push(route.targetTrackId);
            }
        }
    }
    return false;
}

export function removeSidechainRoute(routeId: string): void {
    const state = sidechainStore.value;
    if (!state) {
        return;
    }

    const route = state.routes.find((r) => r.id === routeId);
    if (route) {
        unwireSidechainRoute(route.sourceTrackId, route.targetDeviceId);
    }

    sidechainStore.set({
        routes: state.routes.filter((r) => r.id !== routeId),
    });
}

export function getSidechainRoutesForTrack(trackId: string): SidechainRoute[] {
    const state = sidechainStore.value;
    if (!state) {
        return [];
    }
    return state.routes.filter((r) => r.sourceTrackId === trackId || r.targetTrackId === trackId);
}

export function getSidechainSource(targetDeviceId: string): SidechainRoute | null {
    const state = sidechainStore.value;
    if (!state) {
        return null;
    }
    return state.routes.find((r) => r.targetDeviceId === targetDeviceId) ?? null;
}

export function getAllSidechainRoutes(): SidechainRoute[] {
    return sidechainStore.value?.routes ?? [];
}

export function setSidechainRoutes(routes: SidechainRoute[]): void {
    const state = sidechainStore.value;
    if (state) {
        for (const route of state.routes) {
            unwireSidechainRoute(route.sourceTrackId, route.targetDeviceId);
        }
    }

    sidechainStore.set({ routes });

    for (const route of routes) {
        wireSidechainRoute(route.sourceTrackId, route.targetTrackId, route.targetDeviceId);
    }
}
