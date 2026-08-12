import { adjustmentLayerStore, markerStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { chordTrackStore } from '#/modules/MIDI/stores';
import { transportStore } from '#/modules/Transport/stores';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { type AppAction } from '#/utils/handlerContract';

import { type ProductionBriefScope } from '../models/ProductionBrief';
import { projectStore } from '../stores/projectStore';

function collectActionStrings(value: unknown, values: Set<string>): void {
    if (typeof value === 'string') {
        values.add(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectActionStrings(item, values);
        }
        return;
    }
    if (!value || typeof value !== 'object') {
        return;
    }
    for (const item of Object.values(value)) {
        collectActionStrings(item, values);
    }
}

function valueOverlapsRange(value: unknown, scope: Extract<ProductionBriefScope, { kind: 'range' }>): boolean {
    if (Array.isArray(value)) {
        return value.some((item) => valueOverlapsRange(item, scope));
    }
    if (!value || typeof value !== 'object') {
        return false;
    }
    const values = value as Record<string, unknown>;
    const startBeat = values.startBeat;
    const endBeat = values.endBeat;
    if (typeof startBeat === 'number' && typeof endBeat === 'number') {
        return startBeat < scope.endBeat && endBeat > scope.startBeat;
    }
    const beat = values.beat;
    if (typeof beat === 'number' && beat >= scope.startBeat && beat < scope.endBeat) {
        return true;
    }
    for (const [key, item] of Object.entries(values)) {
        if (key.endsWith('Beat') && typeof item === 'number' && item >= scope.startBeat && item < scope.endBeat) {
            return true;
        }
    }
    return Object.values(values).some((item) => valueOverlapsRange(item, scope));
}

function findClip(clipId: string) {
    for (const track of trackStore.value?.tracks ?? []) {
        const clip = [...track.clips, ...track.alternatives.flatMap((alternative) => alternative.clips)].find(
            (candidate) => candidate.id === clipId
        );
        if (clip) {
            return clip;
        }
    }
    return undefined;
}

function intervalOverlapsRange(
    startBeat: number,
    endBeat: number,
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    return endBeat > startBeat && startBeat < scope.endBeat && endBeat > scope.startBeat;
}

function adjustmentLayerOverlapsRange(
    layer: { readonly regions: readonly { readonly startBeat: number; readonly endBeat: number }[] },
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    return (
        layer.regions.length === 0 ||
        layer.regions.some((region) => intervalOverlapsRange(region.startBeat, region.endBeat, scope))
    );
}

function projectedClipOverlapsRange(
    action: AppAction,
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    if (action.type === 'moveClip') {
        const clip = findClip(action.payload.clipId);
        if (!clip) {
            return false;
        }
        const endBeat = action.payload.startBeat + (clip.endBeat - clip.startBeat);
        return intervalOverlapsRange(action.payload.startBeat, endBeat, scope);
    }
    if (action.type === 'trimClipStart') {
        const clip = findClip(action.payload.clipId);
        return clip ? intervalOverlapsRange(action.payload.newStartBeat, clip.endBeat, scope) : false;
    }
    if (action.type === 'trimClipEnd') {
        const clip = findClip(action.payload.clipId);
        return clip ? intervalOverlapsRange(clip.startBeat, action.payload.newEndBeat, scope) : false;
    }
    if (action.type === 'nudgeClip') {
        const clip = findClip(action.payload.clipId);
        if (!clip) {
            return false;
        }
        const startBeat = Math.max(0, clip.startBeat + action.payload.beats);
        return intervalOverlapsRange(startBeat, startBeat + (clip.endBeat - clip.startBeat), scope);
    }
    if (action.type === 'glueClips') {
        const clips = action.payload.clipIds.flatMap((clipId) => {
            const clip = findClip(clipId);
            return clip ? [clip] : [];
        });
        if (clips.length !== action.payload.clipIds.length) {
            return false;
        }
        return intervalOverlapsRange(
            Math.min(...clips.map((clip) => clip.startBeat)),
            Math.max(...clips.map((clip) => clip.endBeat)),
            scope
        );
    }
    return false;
}

function automationLaneOverlapsRange(
    lane: NonNullable<typeof automationStore.value>['lanes'][number],
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    const lanePoints = [...lane.points, ...(lane.trimPoints ?? []), ...(lane.ghostPoints ?? [])];
    return (
        lanePoints.some((point) => point.beat >= scope.startBeat && point.beat < scope.endBeat) ||
        lane.objects.some((object) => intervalOverlapsRange(object.startBeat, object.endBeat, scope))
    );
}

function referencedAutomationOverlapsRange(
    action: AppAction,
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    const identifiers = new Set<string>();
    collectActionStrings(action.payload, identifiers);
    return (
        automationStore.value?.lanes.some((lane) => {
            if (action.type === 'removeAutomationPoint' && action.payload.laneId === lane.id) {
                const target = action.payload.pointId
                    ? lane.points.find((point) => point.id === action.payload.pointId)
                    : lane.points[action.payload.pointIndex];
                return Boolean(target && target.beat >= scope.startBeat && target.beat < scope.endBeat);
            }
            const referencedPoints = [...lane.points, ...(lane.trimPoints ?? []), ...(lane.ghostPoints ?? [])].filter(
                (point) => point.id && identifiers.has(point.id)
            );
            if (referencedPoints.some((point) => point.beat >= scope.startBeat && point.beat < scope.endBeat)) {
                return true;
            }
            const referencedObjects = lane.objects.filter((object) => identifiers.has(object.id));
            if (referencedObjects.some((object) => intervalOverlapsRange(object.startBeat, object.endBeat, scope))) {
                return true;
            }
            if (
                !identifiers.has(lane.id) ||
                action.type === 'addAutomationPoint' ||
                action.type === 'removeAutomationPoint'
            ) {
                return false;
            }
            return automationLaneOverlapsRange(lane, scope);
        }) ?? false
    );
}

function referencedMarkerOrSectionOverlapsRange(
    action: AppAction,
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    const identifiers = new Set<string>();
    collectActionStrings(action.payload, identifiers);
    return Boolean(
        markerStore.value?.markers.some(
            (marker) => identifiers.has(marker.id) && marker.beat >= scope.startBeat && marker.beat < scope.endBeat
        ) ||
        markerStore.value?.sections.some(
            (section) => identifiers.has(section.id) && intervalOverlapsRange(section.startBeat, section.endBeat, scope)
        )
    );
}

function chordEventOverlapsRange(
    event: { beat: number; duration: number },
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    return intervalOverlapsRange(event.beat, event.beat + event.duration, scope);
}

function chordActionOverlapsRange(action: AppAction, scope: Extract<ProductionBriefScope, { kind: 'range' }>): boolean {
    const currentEvents = chordTrackStore.value?.events ?? [];
    if (
        action.type === 'clearChordTrack' ||
        action.type === 'toggleChordTrack' ||
        action.type === 'restoreChordTrackState'
    ) {
        if (currentEvents.some((event) => chordEventOverlapsRange(event, scope))) {
            return true;
        }
        if (action.type === 'restoreChordTrackState') {
            return action.payload.replacement.events.some((event) => chordEventOverlapsRange(event, scope));
        }
        return false;
    }
    if (action.type === 'addChordEvent') {
        return chordEventOverlapsRange(
            { beat: Math.max(0, action.payload.beat), duration: action.payload.duration ?? 4 },
            scope
        );
    }
    if (action.type !== 'moveChordEvent' && action.type !== 'updateChordEvent' && action.type !== 'removeChordEvent') {
        return false;
    }
    const current = currentEvents.find((event) => event.id === action.payload.eventId);
    if (!current) {
        return false;
    }
    if (chordEventOverlapsRange(current, scope)) {
        return true;
    }
    if (action.type === 'moveChordEvent') {
        return chordEventOverlapsRange({ ...current, beat: Math.max(0, action.payload.beat) }, scope);
    }
    if (action.type === 'updateChordEvent' && action.payload.duration !== undefined) {
        return chordEventOverlapsRange({ ...current, duration: action.payload.duration }, scope);
    }
    return false;
}

function adjustmentLayerActionOverlapsRange(
    action: AppAction,
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    const layers = adjustmentLayerStore.value?.layers ?? [];
    if (action.type === 'createAdjustmentLayer') {
        return true;
    }
    if (action.type === 'addAdjustmentRegion') {
        const layer = layers.find((candidate) => candidate.id === action.payload.layerId);
        return Boolean(
            layer &&
            (adjustmentLayerOverlapsRange(layer, scope) ||
                intervalOverlapsRange(action.payload.startBeat, action.payload.endBeat, scope))
        );
    }
    if (action.type === 'restoreAdjustmentLayerMutation') {
        const currentOverlap = layers.some((layer) => adjustmentLayerOverlapsRange(layer, scope));
        const replacementOverlap = action.payload.layers.some((layer) => adjustmentLayerOverlapsRange(layer, scope));
        return currentOverlap || replacementOverlap;
    }
    if (
        action.type === 'removeAdjustmentRegion' ||
        action.type === 'moveAdjustmentRegion' ||
        action.type === 'setLayerFades'
    ) {
        const region = layers
            .flatMap((layer) => layer.regions)
            .find((candidate) => candidate.id === action.payload.regionId);
        return Boolean(region && intervalOverlapsRange(region.startBeat, region.endBeat, scope));
    }
    if (
        action.type !== 'removeAdjustmentLayer' &&
        action.type !== 'toggleAdjustmentLayer' &&
        action.type !== 'setLayerParameter' &&
        action.type !== 'setLayerMix' &&
        action.type !== 'setLayerAffectedTracks' &&
        action.type !== 'setLayerInsertionIndex'
    ) {
        return false;
    }
    const layer = layers.find((candidate) => candidate.id === action.payload.layerId);
    return Boolean(layer && adjustmentLayerOverlapsRange(layer, scope));
}

function duplicateClipProjectionOverlapsRange(
    action: AppAction,
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    if (action.type !== 'duplicateClip' && action.type !== 'duplicateClipToNextBar') {
        return false;
    }
    const clip = findClip(action.payload.clipId);
    if (!clip) {
        return false;
    }
    const duration = clip.endBeat - clip.startBeat;
    let startBeat = clip.endBeat;
    if (action.type === 'duplicateClipToNextBar') {
        const beatsPerBar = transportStore.value?.timeSignatureNumerator ?? 4;
        startBeat = Math.ceil(clip.endBeat / beatsPerBar) * beatsPerBar;
    }
    return intervalOverlapsRange(startBeat, startBeat + duration, scope);
}

function trackContainerOverlapsRange(
    action: AppAction,
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    if (action.type !== 'removeTrack' && action.type !== 'duplicateTrack') {
        return false;
    }
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === action.payload.trackId);
    if (!track) {
        return false;
    }
    const clipOverlap = [...track.clips, ...track.alternatives.flatMap((alternative) => alternative.clips)].some(
        (clip) => intervalOverlapsRange(clip.startBeat, clip.endBeat, scope)
    );
    const automationOverlap =
        automationStore.value?.lanes.some(
            (lane) => lane.trackId === track.id && automationLaneOverlapsRange(lane, scope)
        ) ?? false;
    return clipOverlap || automationOverlap;
}

function rippleDeleteOverlapsRange(
    action: AppAction,
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    if (action.type !== 'removeClip' || !workspaceStore.value?.rippleEditing) {
        return false;
    }
    const track = trackStore.value?.tracks.find((candidate) =>
        candidate.clips.some((clip) => clip.id === action.payload.clipId)
    );
    const removed = track?.clips.find((clip) => clip.id === action.payload.clipId);
    if (!track || !removed) {
        return false;
    }
    const gap = removed.endBeat - removed.startBeat;
    return track.clips.some((clip) => {
        if (clip.id === removed.id || clip.startBeat < removed.endBeat) {
            return false;
        }
        if (
            intervalOverlapsRange(clip.startBeat, clip.endBeat, scope) ||
            intervalOverlapsRange(clip.startBeat - gap, clip.endBeat - gap, scope)
        ) {
            return true;
        }
        return (
            automationStore.value?.lanes.some(
                (lane) =>
                    lane.clipId === clip.id &&
                    [...lane.points, ...(lane.trimPoints ?? []), ...(lane.ghostPoints ?? [])].some(
                        (point) =>
                            (point.beat >= scope.startBeat && point.beat < scope.endBeat) ||
                            (point.beat - gap >= scope.startBeat && point.beat - gap < scope.endBeat)
                    )
            ) ?? false
        );
    });
}

function globalTimeActionOverlapsRange(
    action: AppAction,
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    if (action.type === 'insertTime') {
        return action.payload.atBeat < scope.endBeat;
    }
    if (action.type === 'deleteTime') {
        return action.payload.startBeat < scope.endBeat;
    }
    return false;
}

function importedStemSetOverlapsRange(
    action: AppAction,
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    if (action.type !== 'importStemSet') {
        return false;
    }
    return action.payload.stems.some((stem) =>
        intervalOverlapsRange(0, (stem.durationSeconds * stem.sourceTempo) / 60, scope)
    );
}

function globalTimeActionMutatesTrack(action: AppAction): boolean {
    return action.type === 'insertTime' || action.type === 'deleteTime';
}

function actionIndirectlyMutatesObject(action: AppAction, objectId: string): boolean {
    if (action.type === 'insertTime' || action.type === 'deleteTime') {
        const clip = findClip(objectId);
        if (clip) {
            const boundary = action.type === 'insertTime' ? action.payload.atBeat : action.payload.startBeat;
            return clip.endBeat > boundary;
        }
        const automationLane = automationStore.value?.lanes.find((lane) => lane.id === objectId);
        if (automationLane) {
            return true;
        }
        const automationPoint = automationStore.value?.lanes
            .flatMap((lane) => [...lane.points, ...(lane.trimPoints ?? []), ...(lane.ghostPoints ?? [])])
            .find((point) => point.id === objectId);
        if (automationPoint) {
            const boundary = action.type === 'insertTime' ? action.payload.atBeat : action.payload.startBeat;
            return automationPoint.beat >= boundary;
        }
        const automationObject = automationStore.value?.lanes
            .flatMap((lane) => lane.objects)
            .find((object) => object.id === objectId);
        if (automationObject) {
            const boundary = action.type === 'insertTime' ? action.payload.atBeat : action.payload.startBeat;
            return automationObject.endBeat > boundary;
        }
        const marker = markerStore.value?.markers.find((candidate) => candidate.id === objectId);
        if (marker) {
            const boundary = action.type === 'insertTime' ? action.payload.atBeat : action.payload.startBeat;
            return marker.beat >= boundary;
        }
        const section = markerStore.value?.sections.find((candidate) => candidate.id === objectId);
        if (section && action.type === 'deleteTime') {
            return section.endBeat > action.payload.startBeat;
        }
    }
    if (action.type !== 'removeClip' || !workspaceStore.value?.rippleEditing) {
        return false;
    }
    const lockedClip = findClip(objectId);
    const removedClip = findClip(action.payload.clipId);
    return Boolean(
        lockedClip &&
        removedClip &&
        lockedClip.trackId === removedClip.trackId &&
        lockedClip.id !== removedClip.id &&
        lockedClip.startBeat >= removedClip.endBeat
    );
}

function actionOverlapsRange(action: AppAction, scope: Extract<ProductionBriefScope, { kind: 'range' }>): boolean {
    return (
        valueOverlapsRange(action.payload, scope) ||
        referencedClipOverlapsRange(action, scope) ||
        projectedClipOverlapsRange(action, scope) ||
        referencedAutomationOverlapsRange(action, scope) ||
        referencedMarkerOrSectionOverlapsRange(action, scope) ||
        chordActionOverlapsRange(action, scope) ||
        adjustmentLayerActionOverlapsRange(action, scope) ||
        duplicateClipProjectionOverlapsRange(action, scope) ||
        trackContainerOverlapsRange(action, scope) ||
        rippleDeleteOverlapsRange(action, scope) ||
        importedStemSetOverlapsRange(action, scope) ||
        globalTimeActionOverlapsRange(action, scope)
    );
}

function trackOwnedIds(trackId: string): Set<string> {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
        return new Set([trackId]);
    }
    const automationLanes = automationStore.value?.lanes.filter((lane) => lane.trackId === trackId) ?? [];
    const adjustmentLayers =
        adjustmentLayerStore.value?.layers.filter(
            (layer) => layer.affectedTrackIds.length === 0 || layer.affectedTrackIds.includes(trackId)
        ) ?? [];
    return new Set([
        track.id,
        ...track.clips.map((clip) => clip.id),
        ...track.alternatives.map((alternative) => alternative.id),
        ...track.alternatives.flatMap((alternative) => alternative.clips.map((clip) => clip.id)),
        ...track.devices.map((device) => device.id),
        ...track.midiFx.map((device) => device.id),
        ...automationLanes.map((lane) => lane.id),
        ...automationLanes.flatMap((lane) => lane.points.flatMap((point) => (point.id ? [point.id] : []))),
        ...automationLanes.flatMap((lane) => lane.objects.map((object) => object.id)),
        ...adjustmentLayers.map((layer) => layer.id),
        ...adjustmentLayers.flatMap((layer) => layer.regions.map((region) => region.id)),
    ]);
}

function referencedClipOverlapsRange(
    action: AppAction,
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    const identifiers = new Set<string>();
    collectActionStrings(action.payload, identifiers);
    return (
        trackStore.value?.tracks.some((track) =>
            [...track.clips, ...track.alternatives.flatMap((alternative) => alternative.clips)].some(
                (clip) => identifiers.has(clip.id) && clip.startBeat < scope.endBeat && clip.endBeat > scope.startBeat
            )
        ) ?? false
    );
}

export function doesProductionBriefAllowActionBatch(actions: readonly AppAction[]): boolean {
    const brief = projectStore.value?.productionBrief;
    if (!brief || actions.every((action) => action.type === 'setProductionBrief')) {
        return true;
    }

    if (actions.some((action) => action.type === 'setProductionBrief')) {
        return false;
    }

    const projectActions = actions.filter((action) => action.type !== 'setProductionBrief');
    const actionStrings = new Set<string>();
    for (const action of projectActions) {
        collectActionStrings(action.payload, actionStrings);
    }

    const protectedScopes = [
        ...brief.locks.map((lock) => lock.scope),
        ...brief.decisions.filter((decision) => decision.status === 'locked').map((decision) => decision.scope),
    ];
    if (
        protectedScopes.length > 0 &&
        projectActions.some((action) => action.type === 'cutClip' || action.type === 'pasteClip')
    ) {
        return false;
    }

    return protectedScopes.every((scope) => {
        if (scope.kind === 'project') {
            return false;
        }
        if (scope.kind === 'range') {
            return projectActions.every((action) => !actionOverlapsRange(action, scope));
        }
        if (scope.kind === 'track') {
            if (projectActions.some((action) => action.type === 'createAdjustmentLayer')) {
                return false;
            }
            if (projectActions.some(globalTimeActionMutatesTrack)) {
                return false;
            }
            const ownedIds = trackOwnedIds(scope.trackId);
            return [...ownedIds].every((id) => !actionStrings.has(id));
        }
        if (scope.kind === 'section') {
            if (actionStrings.has(scope.sectionId)) {
                return false;
            }
            const section = markerStore.value?.sections.find((candidate) => candidate.id === scope.sectionId);
            if (!section) {
                return true;
            }
            const sectionRange = { kind: 'range' as const, startBeat: section.startBeat, endBeat: section.endBeat };
            return projectActions.every((action) => !actionOverlapsRange(action, sectionRange));
        }
        if (scope.kind === 'object') {
            return (
                !actionStrings.has(scope.objectId) &&
                projectActions.every((action) => !actionIndirectlyMutatesObject(action, scope.objectId))
            );
        }
        return !actionStrings.has(scope.decisionId);
    });
}
