import { normalizeTrack } from '#/modules/Arrangement/useCases';
import {
    adjustmentLayerStore,
    markerStore,
    trackStore,
    type AdjustmentEffectType,
    type AdjustmentLayer,
} from '#/modules/Arrangement/stores';
import { type AutomationCurveType, type AutomationLane } from '#/modules/Automation/models/Automation';
import { automationStore } from '#/modules/Automation/stores';

import { type ProjectAdjustmentLayer, type ProjectData } from '../../../models/ProjectData';

export function hydrateModuleStoresFromProjectData(data: ProjectData): void {
    if (data.arrangement?.tracks) {
        trackStore.set({
            tracks: data.arrangement.tracks.map(normalizeTrack),
            selectedTrackId: null,
        });
    }

    // 2. Automation
    if (data.automation) {
        automationStore.set({
            lanes: (data.automation.lanes || []).map((length) => ({
                ...length,
                enabled: length.enabled ?? true,
                visible: length.visible ?? true,
                collapsed: length.collapsed ?? false,
                virginTerritory: length.virginTerritory ?? true,
                minValue: length.minValue ?? 0,
                maxValue: length.maxValue ?? 1,
                objects: length.objects || [],
                points: length.points.map((param) => ({
                    ...param,
                    curve: param.curve as AutomationCurveType,
                    tension: param.tension ?? 0,
                })),
            })) as AutomationLane[],
        });
    }

    // 3. Markers
    if (data.markers) {
        markerStore.set({
            markers: data.markers.map((message) => ({
                id: message.id,
                beat: message.beat,
                name: message.name || 'Untitled',
                color: message.color,
            })),
            sections: [],
        });
    }

    // 4. Adjustment layers — hydrate after tracks so affectedTrackIds can resolve.
    const hydratedLayers = hydrateAdjustmentLayers(data.adjustmentLayers?.layers);
    adjustmentLayerStore.set({ layers: hydratedLayers });
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
