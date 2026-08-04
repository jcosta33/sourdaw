import {
    hydrateClipGainEnvelopes,
    hydrateVcaGroups,
    restoreAdjustmentLayerSnapshot,
} from '#/modules/Arrangement/useCases';
import { hydrateModulationState } from '#/modules/Automation/useCases';
import { hydrateCvGateState } from '#/modules/CvGate/useCases';
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

    // Unconditional: each owner clears its store when the field is absent, so a
    // project that carries no mix state of a given kind cannot inherit the
    // outgoing project's.
    hydrateVcaGroups(data.vcaGroups);
    hydrateClipGainEnvelopes(data.gainEnvelopes);
    hydrateModulationState(data.modulation);
    hydrateCvGateState(data.cvGate);

    setSidechainRoutes(data.sidechainRoutes ?? []);
}
