import { routingConnectionKey, routingMatrixStore, type RoutingMatrixState } from '../../stores/routingMatrixStore';

const emptyState: RoutingMatrixState = { connections: {} };

/**
 * Toggle a routing connection between a source track and a destination: adds the
 * connection at unit level when absent, removes it when present. Write boundary
 * for the routing-matrix store so the RoutingMatrix view no longer mutates the
 * store inline.
 */
export function toggleRoutingConnection(sourceId: string, destId: string): void {
    const key = routingConnectionKey(sourceId, destId);
    const current = routingMatrixStore.value ?? emptyState;
    const next = { ...current.connections };
    if (key in next) {
        delete next[key];
    } else {
        next[key] = { sourceId, destId, level: 1.0 };
    }
    routingMatrixStore.set({ connections: next });
}
