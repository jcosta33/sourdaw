import { logger } from '#/infra/logger/appLogger';

import { sidechainStore } from '../stores/sidechainStore';

import { reconcileSidechainRouteRuntime } from './sidechain/reconcileSidechainRouteRuntime';

/**
 * Hydrates durable sidechain truth, then reconciles every runtime key that was
 * present before or after hydration so removed edges are unwired and added or
 * changed edges are wired from the authoritative projection.
 */
export function hydrateSidechainRoutes(): void {
    const previous_routes = sidechainStore.value?.routes ?? [];
    sidechainStore.hydrate();
    const current_routes = sidechainStore.value?.routes ?? [];

    const runtime_keys = new Map<string, { sourceTrackId: string; targetDeviceId: string }>();
    for (const route of [...previous_routes, ...current_routes]) {
        const runtime_key = JSON.stringify([route.sourceTrackId, route.targetDeviceId]);
        runtime_keys.set(runtime_key, {
            sourceTrackId: route.sourceTrackId,
            targetDeviceId: route.targetDeviceId,
        });
    }

    for (const runtime_key of runtime_keys.values()) {
        try {
            reconcileSidechainRouteRuntime(runtime_key);
        } catch (error) {
            logger.error(
                new Error('Sidechain runtime reconciliation failed during project hydration', {
                    cause: error,
                })
            );
        }
    }
}
