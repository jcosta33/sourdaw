import { type ActionOf, footprintQueries, type ProductionBriefActionFootprint } from './productionBriefFootprint';

const { findClip, lanePoints } = footprintQueries;

/** Whether shifting everything at or after `boundary` moves the object, `isDelete` marking a range removal. */
function timeShiftMovesObject(
    boundary: number,
    isDelete: boolean,
    objectId: string,
    footprint: ProductionBriefActionFootprint
): boolean {
    const clip = findClip(objectId, footprint);
    if (clip) {
        return clip.endBeat > boundary;
    }
    const automationLane = footprint.automation?.lanes.find((lane) => lane.id === objectId);
    if (automationLane) {
        return true;
    }
    const automationPoint = footprint.automation?.lanes
        .flatMap((lane) => lanePoints(lane))
        .find((point) => point.id === objectId);
    if (automationPoint) {
        return automationPoint.beat >= boundary;
    }
    const automationObject = footprint.automation?.lanes
        .flatMap((lane) => lane.objects)
        .find((object) => object.id === objectId);
    if (automationObject) {
        return automationObject.endBeat > boundary;
    }
    const marker = footprint.markers?.markers.find((candidate) => candidate.id === objectId);
    if (marker) {
        return marker.beat >= boundary;
    }
    const section = footprint.markers?.sections.find((candidate) => candidate.id === objectId);
    if (section && isDelete) {
        return section.endBeat > boundary;
    }
    return false;
}

function insertedTimeMovesObject(
    action: ActionOf<'insertTime'>,
    objectId: string,
    footprint: ProductionBriefActionFootprint
): boolean {
    return timeShiftMovesObject(action.payload.atBeat, false, objectId, footprint);
}

function deletedTimeMovesObject(
    action: ActionOf<'deleteTime'>,
    objectId: string,
    footprint: ProductionBriefActionFootprint
): boolean {
    return timeShiftMovesObject(action.payload.startBeat, true, objectId, footprint);
}

function rippleDeleteMovesObject(
    action: ActionOf<'removeClip'>,
    objectId: string,
    footprint: ProductionBriefActionFootprint
): boolean {
    if (!footprint.rippleEditing) {
        return false;
    }
    const lockedClip = findClip(objectId, footprint);
    const removedClip = findClip(action.payload.clipId, footprint);
    return Boolean(
        lockedClip &&
        removedClip &&
        lockedClip.trackId === removedClip.trackId &&
        lockedClip.id !== removedClip.id &&
        lockedClip.startBeat >= removedClip.endBeat
    );
}

export const indirectMutationRules = {
    none: (): boolean => false,
    insertedTimeMovesObject,
    deletedTimeMovesObject,
    rippleDeleteMovesObject,
};
