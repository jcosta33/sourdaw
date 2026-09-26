import {
    hydrateClipGainEnvelopes,
    hydrateClipWarpStates,
    hydrateVcaGroups,
    restoreAdjustmentLayerSnapshot,
} from '#/modules/Arrangement/useCases';
import { hydrateModulationState } from '#/modules/Automation/useCases';
import { midiLearnStore, sanitizeMidiLearnState } from '#/modules/ControlSurface/stores';
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
    hydrateClipWarpStates(data.warpStates);
    hydrateModulationState(data.modulation);
    hydrateCvGateState(data.cvGate);
    // The owner's sanitizer validates here: one malformed mapping degrades to
    // an empty table instead of rejecting the whole project file, and it
    // always disarms `isLearning` so a foreign file cannot capture the next CC.
    midiLearnStore.set(sanitizeMidiLearnState(data.midiLearn));

    setSidechainRoutes(data.sidechainRoutes ?? []);
}
