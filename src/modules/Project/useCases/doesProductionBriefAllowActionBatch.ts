import { adjustmentLayerStore, markerStore, timelineEditingStore, trackStore } from '#/modules/Arrangement/stores';
import { getHeldClips } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { chordTrackStore } from '#/modules/MIDI/stores';
import { transportStore } from '#/modules/Transport/stores';
import { type AppAction, type AppActionType } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { productionBriefRefusalByActionType } from '../models/ProductionBriefActionRefusal';
import { productionBriefRouteByActionType } from '../models/ProductionBriefActionRoute';
import { carriesClipRelativeBeatsByActionType } from '../models/ProductionBriefClipRelativeBeats';
import { globalTimeMutatesTrackByActionType } from '../models/ProductionBriefGlobalTimeAction';
import { projectStore } from '../stores/projectStore';

import { collectProtectedScopes } from './collectProtectedScopes';
import { isProjectWideScope } from './isProjectWideScope';
import { automationReferenceByActionType } from './productionBriefScope/automationReferenceByActionType';
import { automationReferenceRules } from './productionBriefScope/automationReferenceRules';
import { indirectMutationByActionType } from './productionBriefScope/indirectMutationByActionType';
import { indirectMutationRules } from './productionBriefScope/indirectMutationRules';
import {
    type ActionOf,
    footprintQueries,
    type ProductionBriefActionFootprint,
    type ProductionBriefAutomationLane,
    type ProductionBriefRangeScope,
} from './productionBriefScope/productionBriefFootprint';
import { rangeOverlapByActionType } from './productionBriefScope/rangeOverlapByActionType';
import { rangeOverlapRules } from './productionBriefScope/rangeOverlapRules';

const { collectActionStrings, valueOverlapsRange, intervalOverlapsRange } = footprintQueries;

function captureProductionBriefActionFootprint(actions: readonly AppAction[]): ProductionBriefActionFootprint {
    // Project writers replace store state instead of mutating it, so these admission-time
    // references preserve ownership/range facts without cloning the whole project per action.
    return {
        actions: structuredClone(actions),
        adjustmentLayers: adjustmentLayerStore.value,
        automation: automationStore.value,
        chordTrack: chordTrackStore.value,
        markers: markerStore.value,
        tracks: trackStore.value,
        timeSignatureNumerator: transportStore.value?.timeSignatureNumerator ?? 4,
        rippleEditing: timelineEditingStore.value?.rippleEditing ?? false,
    };
}

// Actions reach this check from persisted batches, macros and model output, so `type` can be a string
// no table holds or an inherited object name such as `constructor`. Only an own entry counts.
function ownValue<Key extends string, Value>(
    table: { readonly [Name in Key]: Value },
    key: Key,
    fallback: Value
): Value {
    return Object.hasOwn(table, key) ? table[key] : fallback;
}

function specificRangeOverlap<Type extends AppActionType>(
    action: ActionOf<Type>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    if (!Object.hasOwn(rangeOverlapByActionType, action.type)) {
        return rangeOverlapRules.none();
    }
    return rangeOverlapByActionType[action.type](action, scope, footprint);
}

function laneReferenceOverlap<Type extends AppActionType>(
    action: ActionOf<Type>,
    lane: ProductionBriefAutomationLane,
    identifiers: ReadonlySet<string>,
    scope: ProductionBriefRangeScope
): boolean {
    if (!Object.hasOwn(automationReferenceByActionType, action.type)) {
        return automationReferenceRules.namesLaneOrContent(action, lane, identifiers, scope);
    }
    return automationReferenceByActionType[action.type](action, lane, identifiers, scope);
}

function indirectlyMutatesObject<Type extends AppActionType>(
    action: ActionOf<Type>,
    objectId: string,
    footprint: ProductionBriefActionFootprint
): boolean {
    if (!Object.hasOwn(indirectMutationByActionType, action.type)) {
        return indirectMutationRules.none();
    }
    return indirectMutationByActionType[action.type](action, objectId, footprint);
}

function referencedAutomationOverlapsRange(
    action: AppAction,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const identifiers = new Set<string>();
    collectActionStrings(action.payload, identifiers);
    return footprint.automation?.lanes.some((lane) => laneReferenceOverlap(action, lane, identifiers, scope)) ?? false;
}

function referencedMarkerOrSectionOverlapsRange(
    action: AppAction,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const identifiers = new Set<string>();
    collectActionStrings(action.payload, identifiers);
    return Boolean(
        footprint.markers?.markers.some(
            (marker) => identifiers.has(marker.id) && marker.beat >= scope.startBeat && marker.beat < scope.endBeat
        ) ||
        footprint.markers?.sections.some(
            (section) => identifiers.has(section.id) && intervalOverlapsRange(section.startBeat, section.endBeat, scope)
        )
    );
}

function actionOverlapsRange(
    action: AppAction,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    if (action.type === 'insertAutomationLanePoints') {
        // The ordered capture includes every untouched point. Only the owner's
        // verified changed beats describe this insertion's range footprint.
        return specificRangeOverlap(action, scope, footprint);
    }
    return (
        (!ownValue(carriesClipRelativeBeatsByActionType, action.type, false) &&
            valueOverlapsRange(action.payload, scope)) ||
        referencedClipOverlapsRange(action, scope, footprint) ||
        referencedAutomationOverlapsRange(action, scope, footprint) ||
        referencedMarkerOrSectionOverlapsRange(action, scope, footprint) ||
        specificRangeOverlap(action, scope, footprint)
    );
}

function trackOwnedIds(trackId: string, footprint: ProductionBriefActionFootprint): Set<string> {
    const track = footprint.tracks?.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
        return new Set([trackId]);
    }
    const automationLanes = footprint.automation?.lanes.filter((lane) => lane.trackId === trackId) ?? [];
    const adjustmentLayers =
        footprint.adjustmentLayers?.layers.filter(
            (layer) => layer.affectedTrackIds.length === 0 || layer.affectedTrackIds.includes(trackId)
        ) ?? [];
    return new Set([
        track.id,
        ...track.alternatives.map((alternative) => alternative.id),
        ...getHeldClips(track).map((clip) => clip.id),
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
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const identifiers = new Set<string>();
    collectActionStrings(action.payload, identifiers);
    return (
        footprint.tracks?.tracks.some((track) =>
            getHeldClips(track).some(
                (clip) => identifiers.has(clip.id) && clip.startBeat < scope.endBeat && clip.endBeat > scope.startBeat
            )
        ) ?? false
    );
}

function doesProductionBriefAllowActionFootprint(footprint: ProductionBriefActionFootprint): boolean {
    const brief = projectStore.value?.productionBrief;
    const { actions } = footprint;
    // Brief changes reconcile their own authorization (`preservesLockedIntent`
    // or an authorized replay), and the project-data repair changes no musical
    // content — a lock protects content, not the reconciliation that lets a
    // broken document be edited again.
    // An action type absent from the route table stays on the scope-checked path.
    const isAdmittedRoute = (action: AppAction): boolean => {
        const route = ownValue(productionBriefRouteByActionType, action.type, 'content');
        return route === 'brief' || route === 'repair';
    };
    if (!brief || actions.every(isAdmittedRoute)) {
        return true;
    }

    if (actions.some((action) => ownValue(productionBriefRouteByActionType, action.type, 'content') === 'brief')) {
        return false;
    }

    const projectActions = actions.filter((action) => !isAdmittedRoute(action));
    const actionStrings = new Set<string>();
    for (const action of projectActions) {
        if (action.type === 'insertAutomationLanePoints') {
            const { laneId, owner, capture } = action.payload;
            actionStrings.add(laneId);
            if (isRecord(owner)) {
                collectActionStrings([owner.trackId, owner.clipId], actionStrings);
            }
            collectActionStrings(capture?.changedPointIds, actionStrings);
        } else {
            collectActionStrings(action.payload, actionStrings);
        }
    }

    const protectedScopes = collectProtectedScopes(brief).map((protection) => protection.scope);
    if (
        protectedScopes.length > 0 &&
        projectActions.some(
            (action) => ownValue(productionBriefRefusalByActionType, action.type, 'none') === 'any-scope'
        )
    ) {
        return false;
    }

    return protectedScopes.every((scope) => {
        if (isProjectWideScope(scope)) {
            return false;
        }
        if (scope.kind === 'range') {
            return projectActions.every((action) => !actionOverlapsRange(action, scope, footprint));
        }
        if (scope.kind === 'track') {
            if (
                projectActions.some(
                    (action) => ownValue(productionBriefRefusalByActionType, action.type, 'none') === 'track-scope'
                )
            ) {
                return false;
            }
            if (projectActions.some((action) => ownValue(globalTimeMutatesTrackByActionType, action.type, false))) {
                return false;
            }
            const ownedIds = trackOwnedIds(scope.trackId, footprint);
            return [...ownedIds].every((id) => !actionStrings.has(id));
        }
        if (scope.kind === 'section') {
            if (actionStrings.has(scope.sectionId)) {
                return false;
            }
            const section = footprint.markers?.sections.find((candidate) => candidate.id === scope.sectionId);
            if (!section) {
                return true;
            }
            const sectionRange = { kind: 'range' as const, startBeat: section.startBeat, endBeat: section.endBeat };
            return projectActions.every((action) => !actionOverlapsRange(action, sectionRange, footprint));
        }
        if (scope.kind === 'object') {
            return (
                !actionStrings.has(scope.objectId) &&
                projectActions.every((action) => !indirectlyMutatesObject(action, scope.objectId, footprint))
            );
        }
        return !actionStrings.has(scope.decisionId);
    });
}

function captureProductionBriefActionBatchAdmission(actions: readonly AppAction[]) {
    const footprint = captureProductionBriefActionFootprint(actions);
    return {
        allowsCurrent(): boolean {
            return doesProductionBriefAllowActionFootprint(footprint);
        },
    };
}

export const productionBriefActionBatchAdmission = {
    capture: captureProductionBriefActionBatchAdmission,
};

export function doesProductionBriefAllowActionBatch(actions: readonly AppAction[]): boolean {
    return captureProductionBriefActionBatchAdmission(actions).allowsCurrent();
}
