import { restoreAdjustmentLayerSnapshot } from '#/modules/Arrangement/useCases';
import { hydrateGrooveTemplates, replaceChordTrackState } from '#/modules/MIDI/useCases';
import { setSidechainRoutes } from '#/modules/Routing/useCases';
import { restoreTransportSnapshot } from '#/modules/Transport/useCases';
import { hydrateYeastState } from '#/modules/Yeast/useCases';

import { type HydratableProjectData } from './isHydratableProjectData';

export function hydrateModuleStoresFromProjectData(data: HydratableProjectData): void {
    if (data.transport) {
        restoreTransportSnapshot(data.transport);
    }

    // Adjustment layers hydrate after the active arrangement so affectedTrackIds resolve.
    restoreAdjustmentLayerSnapshot(data.adjustmentLayers);

    replaceChordTrackState(data.chordTrack);
    hydrateGrooveTemplates(data.grooves ?? { templates: [], assignments: [] });
    hydrateYeastState(data.yeast);

    setSidechainRoutes(data.sidechainRoutes ?? []);
}
