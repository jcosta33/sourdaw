import { createSidechainRoute, type SidechainRoute } from '#/modules/AudioEngine/useCases/audioEngineQueries';

export type { SidechainRoute };
import { wireSidechainRoute, unwireSidechainRoute } from '#/modules/AudioEngine/useCases/engineAccess';

type SidechainState = {
    routes: SidechainRoute[];
};

let sidechainState: SidechainState = { routes: [] };

export function addSidechainRoute(
    sourceTrackId: string,
    targetTrackId: string,
    targetDeviceId: string,
    targetParameterId = 'threshold'
): void {
    const exists = sidechainState.routes.some(
        (r) => r.sourceTrackId === sourceTrackId && r.targetDeviceId === targetDeviceId
    );
    if (exists) {
        return;
    }

    // Cycle detection: walk forward from target to see if we reach source
    if (wouldCreateCycle(sourceTrackId, targetTrackId)) {
        throw new Error(`Sidechain route ${sourceTrackId} → ${targetTrackId} would create a routing cycle`);
    }

    const route = createSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId, targetParameterId);
    sidechainState = { routes: [...sidechainState.routes, route] };

    wireSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId);
}

function wouldCreateCycle(sourceTrackId: string, targetTrackId: string): boolean {
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
        for (const route of sidechainState.routes) {
            if (route.sourceTrackId === current) {
                queue.push(route.targetTrackId);
            }
        }
    }
    return false;
}

export function removeSidechainRoute(routeId: string): void {
    const route = sidechainState.routes.find((r) => r.id === routeId);
    if (route) {
        unwireSidechainRoute(route.sourceTrackId, route.targetDeviceId);
    }

    sidechainState = {
        routes: sidechainState.routes.filter((r) => r.id !== routeId),
    };
}

export function getSidechainRoutesForTrack(trackId: string): SidechainRoute[] {
    return sidechainState.routes.filter((r) => r.sourceTrackId === trackId || r.targetTrackId === trackId);
}

export function getSidechainSource(targetDeviceId: string): SidechainRoute | null {
    return sidechainState.routes.find((r) => r.targetDeviceId === targetDeviceId) ?? null;
}

export function getAllSidechainRoutes(): SidechainRoute[] {
    return sidechainState.routes;
}

export function setSidechainRoutes(routes: SidechainRoute[]): void {
    for (const route of sidechainState.routes) {
        unwireSidechainRoute(route.sourceTrackId, route.targetDeviceId);
    }
    sidechainState = { routes: [] };
    for (const route of routes) {
        sidechainState = { routes: [...sidechainState.routes, route] };
        wireSidechainRoute(route.sourceTrackId, route.targetTrackId, route.targetDeviceId);
    }
}
