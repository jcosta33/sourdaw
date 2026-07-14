import { adjustmentLayerStore, type AdjustmentEffectType, type AdjustmentLayer } from '#/modules/Arrangement/stores';
import { setSidechainRoutes } from '#/modules/Routing/useCases';
import { transportStore, defaultTransportState } from '#/modules/Transport/stores';

import { type ProjectAdjustmentLayer } from '../../../models/ProjectData';

import { type HydratableProjectData } from './isHydratableProjectData';

export function hydrateModuleStoresFromProjectData(data: HydratableProjectData): void {
    // 1b. Transport — the exported transport block is a strict subset of the
    // runtime transport state, so merge it over the defaults (runtime-only
    // fields like isPlaying/playheadPosition stay at their default).
    if (data.transport) {
        transportStore.set({
            ...defaultTransportState,
            tempo: data.transport.tempo,
            timeSignatureNumerator: data.transport.timeSignatureNumerator,
            timeSignatureDenominator: data.transport.timeSignatureDenominator,
            loopStart: data.transport.loopStart,
            loopEnd: data.transport.loopEnd,
            isLooping: data.transport.isLooping,
            metronomeEnabled: data.transport.metronomeEnabled,
            metronomeVolume: data.transport.metronomeVolume,
            punchInEnabled: data.transport.punchInEnabled,
            punchInBeat: data.transport.punchInBeat,
            punchOutBeat: data.transport.punchOutBeat,
            countInEnabled: data.transport.countInEnabled,
            countInBars: data.transport.countInBars,
            preRollEnabled: data.transport.preRollEnabled,
            preRollBars: data.transport.preRollBars,
            masterGain: data.transport.masterGain,
        });
    }

    // Adjustment layers hydrate after the active arrangement so affectedTrackIds resolve.
    const hydratedLayers = hydrateAdjustmentLayers(data.adjustmentLayers?.layers);
    adjustmentLayerStore.set({ layers: hydratedLayers });

    setSidechainRoutes(data.sidechainRoutes ?? []);
}

function hydrateAdjustmentLayers(layers: ProjectAdjustmentLayer[] | undefined): AdjustmentLayer[] {
    if (!layers) {
        return [];
    }
    return layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        effectType: layer.effectType as AdjustmentEffectType,
        parameters: layer.parameters.map((p) => ({ ...p })),
        affectedTrackIds: [...layer.affectedTrackIds],
        insertionIndex: layer.insertionIndex,
        regions: layer.regions.map((r) => ({ ...r })),
        enabled: layer.enabled,
        mix: layer.mix,
        color: layer.color,
    }));
}
