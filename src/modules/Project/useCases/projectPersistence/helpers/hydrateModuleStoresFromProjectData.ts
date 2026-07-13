import {
    adjustmentLayerStore,
    markerStore,
    type AdjustmentEffectType,
    type AdjustmentLayer,
} from '#/modules/Arrangement/stores';
import { hydrateTracksForProject } from '#/modules/Arrangement/useCases';
import { automationStore, type AutomationCurveType, type AutomationLane } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { transportStore, defaultTransportState } from '#/modules/Transport/stores';

import { type ProjectAdjustmentLayer } from '../../../models/ProjectData';
import { hydrateArrangementTracks } from '../fileIO/hydrateArrangementTracks';
import { hydrateProjectMidi } from '../fileIO/hydrateProjectMidi';

import { type HydratableProjectData } from './isHydratableProjectData';

export function hydrateModuleStoresFromProjectData(data: HydratableProjectData): void {
    if (data.arrangement?.tracks) {
        hydrateTracksForProject({ tracks: hydrateArrangementTracks(data.arrangement.tracks) });
    }

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

    // 1c. MIDI — hydrate the MIDI store from the exported top-level midi maps so
    // notes/CC/pitch-bend survive the round-trip. (The per-clip notes folded into
    // the arrangement are reconciled by applyImportedProjectData.)
    if (data.midi) {
        midiStore.set(hydrateProjectMidi(data.midi));
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
