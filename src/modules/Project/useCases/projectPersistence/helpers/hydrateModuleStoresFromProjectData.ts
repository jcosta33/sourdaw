import { migrateLegacyFrozenTrackStates, restoreAdjustmentLayerSnapshot } from '#/modules/Arrangement/useCases';
import { setSidechainRoutes } from '#/modules/Routing/useCases';
import { restoreTransportSnapshot } from '#/modules/Transport/useCases';

import { type HydratableProjectData } from './isHydratableProjectData';

export function hydrateModuleStoresFromProjectData(data: HydratableProjectData): void {
    if (data.transport) {
        restoreTransportSnapshot(data.transport);
    }

    // Adjustment layers hydrate after the active arrangement so affectedTrackIds resolve.
    restoreAdjustmentLayerSnapshot(data.adjustmentLayers);
    migrateLegacyFrozenTrackStates();

    setSidechainRoutes(data.sidechainRoutes ?? []);
}
