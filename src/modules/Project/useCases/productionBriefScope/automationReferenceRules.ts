import {
    type ActionOf,
    footprintQueries,
    type ProductionBriefAutomationLane,
    type ProductionBriefRangeScope,
} from './productionBriefFootprint';

const { intervalOverlapsRange, lanePoints, automationLaneOverlapsRange } = footprintQueries;

function namesOverlappingPointOrObject(
    lane: ProductionBriefAutomationLane,
    identifiers: ReadonlySet<string>,
    scope: ProductionBriefRangeScope
): boolean {
    const referencedPoints = lanePoints(lane).filter((point) => point.id && identifiers.has(point.id));
    if (referencedPoints.some((point) => point.beat >= scope.startBeat && point.beat < scope.endBeat)) {
        return true;
    }
    const referencedObjects = lane.objects.filter((object) => identifiers.has(object.id));
    return referencedObjects.some((object) => intervalOverlapsRange(object.startBeat, object.endBeat, scope));
}

/** An action that names a lane id moves everything the lane holds, so the whole lane counts. */
function namesLaneOrContent(
    _action: unknown,
    lane: ProductionBriefAutomationLane,
    identifiers: ReadonlySet<string>,
    scope: ProductionBriefRangeScope
): boolean {
    if (namesOverlappingPointOrObject(lane, identifiers, scope)) {
        return true;
    }
    if (!identifiers.has(lane.id)) {
        return false;
    }
    return automationLaneOverlapsRange(lane, scope);
}

/** A point edit names its lane without touching the rest of it, so only named content counts. */
function namesContentOnly(
    _action: unknown,
    lane: ProductionBriefAutomationLane,
    identifiers: ReadonlySet<string>,
    scope: ProductionBriefRangeScope
): boolean {
    return namesOverlappingPointOrObject(lane, identifiers, scope);
}

function namesRemovedPoint(
    action: ActionOf<'removeAutomationPoint'>,
    lane: ProductionBriefAutomationLane,
    identifiers: ReadonlySet<string>,
    scope: ProductionBriefRangeScope
): boolean {
    if (action.payload.laneId !== lane.id) {
        return namesContentOnly(action, lane, identifiers, scope);
    }
    const { pointId, pointIndex } = action.payload;
    let target: ProductionBriefAutomationLane['points'][number] | undefined;
    if (pointId) {
        target = lane.points.find((point) => point.id === pointId);
    } else {
        target = lane.points[pointIndex];
    }
    return Boolean(target && target.beat >= scope.startBeat && target.beat < scope.endBeat);
}

export const automationReferenceRules = {
    namesLaneOrContent,
    namesContentOnly,
    namesRemovedPoint,
};
