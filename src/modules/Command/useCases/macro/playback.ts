import { type AppAction } from '#/utils/handlerContract';

import { macroStore } from '../../stores/macroStore';
import { executeAppAction } from '../executeAppAction';
import { generateGroupId } from '../generateGroupId';

type ReplayIdMappings = {
    automationLaneIds: Map<string, string>;
    automationPointIds: Map<string, string>;
    sidechainRouteIds: Map<string, string>;
    chordEventIds: Map<string, string>;
    layerIds: Map<string, string>;
    regionIds: Map<string, string>;
    vcaGroupIds: Map<string, string>;
    markerIds: Map<string, string>;
    sectionIds: Map<string, string>;
    trackAlternativeIds: Map<string, string>;
};

function remapChordReferences(action: AppAction, mappings: ReplayIdMappings): void {
    if (action.type === 'moveChordEvent' || action.type === 'updateChordEvent' || action.type === 'removeChordEvent') {
        action.payload.eventId = mappings.chordEventIds.get(action.payload.eventId) ?? action.payload.eventId;
    }
}

function remapMarkerReferences(action: AppAction, mappings: ReplayIdMappings): void {
    if (action.type === 'removeMarker' || action.type === 'setMarkerColor') {
        action.payload.markerId = mappings.markerIds.get(action.payload.markerId) ?? action.payload.markerId;
        return;
    }
    if (action.type === 'removeSection' || action.type === 'renameSection') {
        action.payload.sectionId = mappings.sectionIds.get(action.payload.sectionId) ?? action.payload.sectionId;
    }
}

function remapTrackAlternativeReferences(action: AppAction, mappings: ReplayIdMappings): void {
    if (
        action.type === 'deleteTrackAlternative' ||
        action.type === 'renameTrackAlternative' ||
        action.type === 'switchTrackAlternative'
    ) {
        action.payload.alternativeId =
            mappings.trackAlternativeIds.get(action.payload.alternativeId) ?? action.payload.alternativeId;
    }
    // Recorded via revertAction (no skipMacroRecording): a create's undo inverse
    // is a deleteTrackAlternative whose fallbackAlternativeId references another
    // recorded alternative — remap it too or the replayed delete degrades to the
    // first-in-list fallback and restores the wrong active alternative.
    if (action.type === 'deleteTrackAlternative' && action.payload.fallbackAlternativeId) {
        action.payload.fallbackAlternativeId =
            mappings.trackAlternativeIds.get(action.payload.fallbackAlternativeId) ??
            action.payload.fallbackAlternativeId;
    }
}

function remapSidechainReferences(action: AppAction, mappings: ReplayIdMappings): void {
    if (action.type === 'removeSidechainRoute' && action.payload.routeId) {
        action.payload.routeId = mappings.sidechainRouteIds.get(action.payload.routeId) ?? action.payload.routeId;
    }
}

function remapLayerId(layerId: string, mappings: ReplayIdMappings): string {
    return mappings.layerIds.get(layerId) ?? layerId;
}

function remapRegionId(regionId: string, mappings: ReplayIdMappings): string {
    return mappings.regionIds.get(regionId) ?? regionId;
}

function remapVcaGroupId(vcaGroupId: string, mappings: ReplayIdMappings): string {
    return mappings.vcaGroupIds.get(vcaGroupId) ?? vcaGroupId;
}

function remapVcaReferences(action: AppAction, mappings: ReplayIdMappings): void {
    if (action.type === 'assignToVca' || action.type === 'setVcaGain') {
        action.payload.vcaGroupId = remapVcaGroupId(action.payload.vcaGroupId, mappings);
    }
}

function remapAutomationLaneId(laneId: string, mappings: ReplayIdMappings): string {
    return mappings.automationLaneIds.get(laneId) ?? laneId;
}

function remapAutomationPointSnapshots(
    points: Extract<AppAction, { type: 'restoreAutomationLanePoints' }>['payload']['points'],
    mappings: ReplayIdMappings
): Extract<AppAction, { type: 'restoreAutomationLanePoints' }>['payload']['points'] {
    return points.map((point) =>
        point.id ? { ...point, id: mappings.automationPointIds.get(point.id) ?? point.id } : point
    );
}

function remapAutomationReferences(action: AppAction, mappings: ReplayIdMappings): void {
    if (
        action.type === 'removeAutomationLane' ||
        action.type === 'setAutomationLaneEnabled' ||
        action.type === 'addAutomationPoint' ||
        action.type === 'removeAutomationPoint' ||
        action.type === 'scaleAutomation' ||
        action.type === 'stretchAutomation' ||
        action.type === 'invertAutomation' ||
        action.type === 'reverseAutomation' ||
        action.type === 'thinAutomation' ||
        action.type === 'quantizeAutomation' ||
        action.type === 'restoreAutomationLanePoints'
    ) {
        action.payload.laneId = remapAutomationLaneId(action.payload.laneId, mappings);
    }

    if (action.type === 'restoreAutomationLanePoints') {
        action.payload.points = remapAutomationPointSnapshots(action.payload.points, mappings);
        if (action.payload.expectedPoints) {
            action.payload.expectedPoints = remapAutomationPointSnapshots(action.payload.expectedPoints, mappings);
        }
    }
    if (action.type === 'removeAutomationPoint' && action.payload.pointId) {
        action.payload.pointId = mappings.automationPointIds.get(action.payload.pointId) ?? action.payload.pointId;
    }
}

function remapAdjustmentReferences(action: AppAction, mappings: ReplayIdMappings): void {
    if (
        action.type === 'removeAdjustmentLayer' ||
        action.type === 'toggleAdjustmentLayer' ||
        action.type === 'setLayerParameter' ||
        action.type === 'setLayerMix' ||
        action.type === 'setLayerAffectedTracks' ||
        action.type === 'setLayerInsertionIndex'
    ) {
        action.payload.layerId = remapLayerId(action.payload.layerId, mappings);
        return;
    }
    if (action.type === 'removeAdjustmentRegion') {
        action.payload.layerId = remapLayerId(action.payload.layerId, mappings);
        action.payload.regionId = remapRegionId(action.payload.regionId, mappings);
        return;
    }
    if (action.type === 'moveAdjustmentRegion' || action.type === 'setLayerFades') {
        action.payload.regionId = remapRegionId(action.payload.regionId, mappings);
    }
}

function getGeneratedLayerId(action: AppAction): string | undefined {
    return action.type === 'createAdjustmentLayer' ? action.payload.layerId : undefined;
}
function getGeneratedChordEventId(action: AppAction): string | undefined {
    return action.type === 'addChordEvent' ? action.payload.eventId : undefined;
}

function getGeneratedRegionId(action: AppAction): string | undefined {
    return action.type === 'addAdjustmentRegion' ? action.payload.regionId : undefined;
}

function getGeneratedVcaGroupId(action: AppAction): string | undefined {
    if (action.type === 'createVcaGroup') {
        return action.payload.vcaGroupId;
    }
    return undefined;
}

function getGeneratedMarkerId(action: AppAction): string | undefined {
    return action.type === 'addMarker' ? action.payload.markerId : undefined;
}

function getGeneratedSectionId(action: AppAction): string | undefined {
    return action.type === 'addSection' ? action.payload.sectionId : undefined;
}

function getGeneratedTrackAlternativeId(action: AppAction): string | undefined {
    return action.type === 'createTrackAlternative' ? action.payload.alternativeId : undefined;
}

function getGeneratedAutomationLaneId(action: AppAction): string | undefined {
    return action.type === 'addAutomationLane' ? action.payload.laneId : undefined;
}

function getGeneratedAutomationPointId(action: AppAction): string | undefined {
    return action.type === 'addAutomationPoint' ? action.payload.pointId : undefined;
}

function getGeneratedSidechainRouteId(action: AppAction): string | undefined {
    return action.type === 'addSidechainRoute' ? action.payload.routeId : undefined;
}

async function executeMacroAction(
    action: AppAction,
    mappings: ReplayIdMappings,
    options: { groupId: string; groupLabel: string }
): Promise<void> {
    const replayAction = structuredClone(action);
    if (replayAction.type === 'addSidechainRoute') {
        const recordedRouteId = replayAction.payload.routeId;
        delete replayAction.payload.routeId;
        await executeAppAction(replayAction, options);
        const generatedRouteId = getGeneratedSidechainRouteId(replayAction);
        if (recordedRouteId && generatedRouteId) {
            mappings.sidechainRouteIds.set(recordedRouteId, generatedRouteId);
        }
        return;
    }
    if (replayAction.type === 'addAutomationLane') {
        const recordedLaneId = replayAction.payload.laneId;
        delete replayAction.payload.laneId;
        await executeAppAction(replayAction, options);
        const generatedLaneId = getGeneratedAutomationLaneId(replayAction);
        if (recordedLaneId && generatedLaneId) {
            mappings.automationLaneIds.set(recordedLaneId, generatedLaneId);
        }
        return;
    }
    if (replayAction.type === 'addAutomationPoint') {
        replayAction.payload.laneId = remapAutomationLaneId(replayAction.payload.laneId, mappings);
        const recordedPointId = replayAction.payload.pointId;
        delete replayAction.payload.pointId;
        await executeAppAction(replayAction, options);
        const generatedPointId = getGeneratedAutomationPointId(replayAction);
        if (recordedPointId && generatedPointId) {
            mappings.automationPointIds.set(recordedPointId, generatedPointId);
        }
        return;
    }
    if (replayAction.type === 'addChordEvent') {
        const recordedEventId = replayAction.payload.eventId;
        delete replayAction.payload.eventId;
        await executeAppAction(replayAction, options);
        const generatedEventId = getGeneratedChordEventId(replayAction);
        if (recordedEventId && generatedEventId) {
            mappings.chordEventIds.set(recordedEventId, generatedEventId);
        }
        return;
    }
    if (replayAction.type === 'createAdjustmentLayer') {
        const recordedLayerId = replayAction.payload.layerId;
        delete replayAction.payload.layerId;
        await executeAppAction(replayAction, options);
        const generatedLayerId = getGeneratedLayerId(replayAction);
        if (recordedLayerId && generatedLayerId) {
            mappings.layerIds.set(recordedLayerId, generatedLayerId);
        }
        return;
    }

    if (replayAction.type === 'duplicateClipAt') {
        // The recorded copy id was consumed by the recorded gesture's undo: on
        // replay the copy still exists, so the pinned id would make the handler
        // no-write and the step would silently vanish. Clear it so the handler
        // mints a fresh copy, like every create branch above.
        delete replayAction.payload.targetClipId;
        await executeAppAction(replayAction, options);
        return;
    }

    if (replayAction.type === 'addAdjustmentRegion') {
        replayAction.payload.layerId = remapLayerId(replayAction.payload.layerId, mappings);
        const recordedRegionId = replayAction.payload.regionId;
        delete replayAction.payload.regionId;
        await executeAppAction(replayAction, options);
        const generatedRegionId = getGeneratedRegionId(replayAction);
        if (recordedRegionId && generatedRegionId) {
            mappings.regionIds.set(recordedRegionId, generatedRegionId);
        }
        return;
    }

    if (replayAction.type === 'createVcaGroup') {
        const recordedVcaGroupId = replayAction.payload.vcaGroupId;
        delete replayAction.payload.vcaGroupId;
        await executeAppAction(replayAction, options);
        const generatedVcaGroupId = getGeneratedVcaGroupId(replayAction);
        if (recordedVcaGroupId && generatedVcaGroupId) {
            mappings.vcaGroupIds.set(recordedVcaGroupId, generatedVcaGroupId);
        }
        return;
    }

    if (replayAction.type === 'addMarker') {
        const recordedMarkerId = replayAction.payload.markerId;
        delete replayAction.payload.markerId;
        await executeAppAction(replayAction, options);
        const generatedMarkerId = getGeneratedMarkerId(replayAction);
        if (recordedMarkerId && generatedMarkerId) {
            mappings.markerIds.set(recordedMarkerId, generatedMarkerId);
        }
        return;
    }

    if (replayAction.type === 'addSection') {
        const recordedSectionId = replayAction.payload.sectionId;
        delete replayAction.payload.sectionId;
        await executeAppAction(replayAction, options);
        const generatedSectionId = getGeneratedSectionId(replayAction);
        if (recordedSectionId && generatedSectionId) {
            mappings.sectionIds.set(recordedSectionId, generatedSectionId);
        }
        return;
    }

    if (replayAction.type === 'createTrackAlternative') {
        const recordedAlternativeId = replayAction.payload.alternativeId;
        delete replayAction.payload.alternativeId;
        await executeAppAction(replayAction, options);
        const generatedAlternativeId = getGeneratedTrackAlternativeId(replayAction);
        if (recordedAlternativeId && generatedAlternativeId) {
            mappings.trackAlternativeIds.set(recordedAlternativeId, generatedAlternativeId);
        }
        return;
    }

    remapAutomationReferences(replayAction, mappings);
    remapSidechainReferences(replayAction, mappings);
    remapAdjustmentReferences(replayAction, mappings);
    remapChordReferences(replayAction, mappings);
    remapVcaReferences(replayAction, mappings);
    remapMarkerReferences(replayAction, mappings);
    remapTrackAlternativeReferences(replayAction, mappings);
    await executeAppAction(replayAction, options);
}

/**
 * Replay a saved macro by dispatching each action in sequence.
 * All actions share a single undo group so the entire macro can be
 * undone/redone as one atomic operation.
 */
export async function playMacro(macroId: string): Promise<void> {
    const state = macroStore.value;
    if (!state) {
        return;
    }

    const macro = state.macros.find((message) => message.id === macroId);
    if (!macro) {
        return;
    }

    // Singleton-marked actions (domain-singleton handlers such as drawClip and
    // moveClips) replay through this same per-action loop — the individual
    // dispatch path they are defined for — instead of being refused. The kernel
    // drops the group id for them, so each lands as its own undo entry; every
    // batch-capable action still shares the macro's group below.
    const { groupId, groupLabel } = generateGroupId(`Macro: ${macro.name}`);
    const replayIdMappings: ReplayIdMappings = {
        automationLaneIds: new Map(),
        automationPointIds: new Map(),
        sidechainRouteIds: new Map(),
        chordEventIds: new Map(),
        layerIds: new Map(),
        regionIds: new Map(),
        vcaGroupIds: new Map(),
        markerIds: new Map(),
        sectionIds: new Map(),
        trackAlternativeIds: new Map(),
    };

    for (const action of macro.actions) {
        await executeMacroAction(action, replayIdMappings, { groupId, groupLabel });
    }
}
