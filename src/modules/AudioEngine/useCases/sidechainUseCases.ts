import { createSidechainRoute, type SidechainRoute } from "../models/SidechainRoute";
import { audioEngine } from "../repositories/audioEngineInstance";

type SidechainState = {
    routes: SidechainRoute[];
};

let sidechainState: SidechainState = { routes: [] };

export const addSidechainRoute = (
    sourceTrackId: string,
    targetTrackId: string,
    targetDeviceId: string,
    targetParameterId = "threshold",
): void => {
    const exists = sidechainState.routes.some(
        (r) => r.sourceTrackId === sourceTrackId && r.targetDeviceId === targetDeviceId,
    );
    if (exists) {
        return;
    }

    const route = createSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId, targetParameterId);
    sidechainState = { routes: [...sidechainState.routes, route] };

    audioEngine.wireSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId);
};

export const removeSidechainRoute = (routeId: string): void => {
    const route = sidechainState.routes.find((r) => r.id === routeId);
    if (route) {
        audioEngine.unwireSidechainRoute(route.sourceTrackId, route.targetDeviceId);
    }

    sidechainState = {
        routes: sidechainState.routes.filter((r) => r.id !== routeId),
    };
};

export const getSidechainRoutesForTrack = (trackId: string): SidechainRoute[] => {
    return sidechainState.routes.filter(
        (r) => r.sourceTrackId === trackId || r.targetTrackId === trackId,
    );
};

export const getSidechainSource = (targetDeviceId: string): SidechainRoute | null => {
    return sidechainState.routes.find((r) => r.targetDeviceId === targetDeviceId) ?? null;
};

export const getAllSidechainRoutes = (): SidechainRoute[] => {
    return sidechainState.routes;
};

export const setSidechainRoutes = (routes: SidechainRoute[]): void => {
    for (const route of sidechainState.routes) {
        audioEngine.unwireSidechainRoute(route.sourceTrackId, route.targetDeviceId);
    }
    sidechainState = { routes: [] };
    for (const route of routes) {
        sidechainState = { routes: [...sidechainState.routes, route] };
        audioEngine.wireSidechainRoute(route.sourceTrackId, route.targetTrackId, route.targetDeviceId);
    }
};
