import { getHeldClips } from '#/modules/Arrangement/useCases';

import {
    type ActionOf,
    footprintQueries,
    type ProductionBriefActionFootprint,
    type ProductionBriefRangeScope,
} from './productionBriefFootprint';

const { findClip, intervalOverlapsRange, adjustmentLayerOverlapsRange, lanePoints, automationLaneOverlapsRange } =
    footprintQueries;

type ChordEvent = { readonly beat: number; readonly duration: number };

function chordEventOverlapsRange(event: ChordEvent, scope: ProductionBriefRangeScope): boolean {
    return intervalOverlapsRange(event.beat, event.beat + event.duration, scope);
}

function movedClip(
    action: ActionOf<'moveClip'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const clip = findClip(action.payload.clipId, footprint);
    if (!clip) {
        return false;
    }
    const endBeat = action.payload.startBeat + (clip.endBeat - clip.startBeat);
    return intervalOverlapsRange(action.payload.startBeat, endBeat, scope);
}

function trimmedClipStart(
    action: ActionOf<'trimClipStart'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const clip = findClip(action.payload.clipId, footprint);
    return clip ? intervalOverlapsRange(action.payload.newStartBeat, clip.endBeat, scope) : false;
}

function trimmedClipEnd(
    action: ActionOf<'trimClipEnd'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const clip = findClip(action.payload.clipId, footprint);
    return clip ? intervalOverlapsRange(clip.startBeat, action.payload.newEndBeat, scope) : false;
}

function nudgedClip(
    action: ActionOf<'nudgeClip'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const clip = findClip(action.payload.clipId, footprint);
    if (!clip) {
        return false;
    }
    const startBeat = Math.max(0, clip.startBeat + action.payload.beats);
    return intervalOverlapsRange(startBeat, startBeat + (clip.endBeat - clip.startBeat), scope);
}

function gluedClips(
    action: ActionOf<'glueClips'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const clips = action.payload.clipIds.flatMap((clipId) => {
        const clip = findClip(clipId, footprint);
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

function chordTrackContent(
    _action: ActionOf<'clearChordTrack' | 'toggleChordTrack'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    return (footprint.chordTrack?.events ?? []).some((event) => chordEventOverlapsRange(event, scope));
}

function restoredChordTrack(
    action: ActionOf<'restoreChordTrackState'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    if ((footprint.chordTrack?.events ?? []).some((event) => chordEventOverlapsRange(event, scope))) {
        return true;
    }
    return action.payload.replacement.events.some((event) => chordEventOverlapsRange(event, scope));
}

function addedChordEvent(action: ActionOf<'addChordEvent'>, scope: ProductionBriefRangeScope): boolean {
    return chordEventOverlapsRange(
        { beat: Math.max(0, action.payload.beat), duration: action.payload.duration ?? 4 },
        scope
    );
}

function currentChordEvent(
    action: ActionOf<'moveChordEvent' | 'updateChordEvent' | 'removeChordEvent'>,
    footprint: ProductionBriefActionFootprint
) {
    return (footprint.chordTrack?.events ?? []).find((event) => event.id === action.payload.eventId);
}

function movedChordEvent(
    action: ActionOf<'moveChordEvent'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const current = currentChordEvent(action, footprint);
    if (!current) {
        return false;
    }
    return (
        chordEventOverlapsRange(current, scope) ||
        chordEventOverlapsRange({ ...current, beat: Math.max(0, action.payload.beat) }, scope)
    );
}

function updatedChordEvent(
    action: ActionOf<'updateChordEvent'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const current = currentChordEvent(action, footprint);
    if (!current) {
        return false;
    }
    if (chordEventOverlapsRange(current, scope)) {
        return true;
    }
    if (action.payload.duration === undefined) {
        return false;
    }
    return chordEventOverlapsRange({ ...current, duration: action.payload.duration }, scope);
}

function removedChordEvent(
    action: ActionOf<'removeChordEvent'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const current = currentChordEvent(action, footprint);
    return current ? chordEventOverlapsRange(current, scope) : false;
}

function createdAdjustmentLayer(): boolean {
    return true;
}

function addedAdjustmentRegion(
    action: ActionOf<'addAdjustmentRegion'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const layer = (footprint.adjustmentLayers?.layers ?? []).find(
        (candidate) => candidate.id === action.payload.layerId
    );
    return Boolean(
        layer &&
        (adjustmentLayerOverlapsRange(layer, scope) ||
            intervalOverlapsRange(action.payload.startBeat, action.payload.endBeat, scope))
    );
}

function restoredAdjustmentLayers(
    action: ActionOf<'restoreAdjustmentLayerMutation'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const currentOverlap = (footprint.adjustmentLayers?.layers ?? []).some((layer) =>
        adjustmentLayerOverlapsRange(layer, scope)
    );
    const replacementOverlap = action.payload.layers.some((layer) => adjustmentLayerOverlapsRange(layer, scope));
    return currentOverlap || replacementOverlap;
}

function adjustmentRegionNamed(
    action: ActionOf<'removeAdjustmentRegion' | 'moveAdjustmentRegion' | 'setLayerFades'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const region = (footprint.adjustmentLayers?.layers ?? [])
        .flatMap((layer) => layer.regions)
        .find((candidate) => candidate.id === action.payload.regionId);
    return Boolean(region && intervalOverlapsRange(region.startBeat, region.endBeat, scope));
}

function adjustmentLayerNamed(
    action: ActionOf<
        | 'removeAdjustmentLayer'
        | 'toggleAdjustmentLayer'
        | 'setLayerParameter'
        | 'setLayerMix'
        | 'setLayerAffectedTracks'
        | 'setLayerInsertionIndex'
    >,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const layer = (footprint.adjustmentLayers?.layers ?? []).find(
        (candidate) => candidate.id === action.payload.layerId
    );
    return Boolean(layer && adjustmentLayerOverlapsRange(layer, scope));
}

function duplicatedClipAfterItself(
    action: ActionOf<'duplicateClip'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const clip = findClip(action.payload.clipId, footprint);
    if (!clip) {
        return false;
    }
    return intervalOverlapsRange(clip.endBeat, clip.endBeat + (clip.endBeat - clip.startBeat), scope);
}

function duplicatedClipToNextBar(
    action: ActionOf<'duplicateClipToNextBar'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const clip = findClip(action.payload.clipId, footprint);
    if (!clip) {
        return false;
    }
    const beatsPerBar = footprint.timeSignatureNumerator;
    const startBeat = Math.ceil(clip.endBeat / beatsPerBar) * beatsPerBar;
    return intervalOverlapsRange(startBeat, startBeat + (clip.endBeat - clip.startBeat), scope);
}

function trackContent(
    action: ActionOf<'removeTrack' | 'duplicateTrack'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    const track = footprint.tracks?.tracks.find((candidate) => candidate.id === action.payload.trackId);
    if (!track) {
        return false;
    }
    const clipOverlap = getHeldClips(track).some((clip) => intervalOverlapsRange(clip.startBeat, clip.endBeat, scope));
    const automationOverlap =
        footprint.automation?.lanes.some(
            (lane) => lane.trackId === track.id && automationLaneOverlapsRange(lane, scope)
        ) ?? false;
    return clipOverlap || automationOverlap;
}

function clipsShiftedByRippleDelete(
    action: ActionOf<'removeClip'>,
    scope: ProductionBriefRangeScope,
    footprint: ProductionBriefActionFootprint
): boolean {
    if (!footprint.rippleEditing) {
        return false;
    }
    const track = footprint.tracks?.tracks.find((candidate) =>
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
            footprint.automation?.lanes.some(
                (lane) =>
                    lane.clipId === clip.id &&
                    lanePoints(lane).some(
                        (point) =>
                            (point.beat >= scope.startBeat && point.beat < scope.endBeat) ||
                            (point.beat - gap >= scope.startBeat && point.beat - gap < scope.endBeat)
                    )
            ) ?? false
        );
    });
}

function importedStems(action: ActionOf<'importStemSet'>, scope: ProductionBriefRangeScope): boolean {
    return action.payload.stems.some((stem) =>
        intervalOverlapsRange(0, (stem.durationSeconds * stem.sourceTempo) / 60, scope)
    );
}

function insertedAutomationLanePoints(
    action: ActionOf<'insertAutomationLanePoints'>,
    scope: ProductionBriefRangeScope
): boolean {
    const { capture, insertion } = action.payload;
    if (insertion?.kind === 'shape' && intervalOverlapsRange(insertion.startBeat, insertion.endBeat, scope)) {
        return true;
    }
    const changedBeats = capture?.changedBeats;
    return Array.isArray(changedBeats) && changedBeats.some((beat) => beat >= scope.startBeat && beat < scope.endBeat);
}

function insertedTime(action: ActionOf<'insertTime'>, scope: ProductionBriefRangeScope): boolean {
    return action.payload.atBeat < scope.endBeat;
}

function deletedTime(action: ActionOf<'deleteTime'>, scope: ProductionBriefRangeScope): boolean {
    return action.payload.startBeat < scope.endBeat;
}

/** What an action overlaps beyond the payload and referenced-object scans every action shares. */
export const rangeOverlapRules = {
    none: (): boolean => false,
    movedClip,
    trimmedClipStart,
    trimmedClipEnd,
    nudgedClip,
    gluedClips,
    chordTrackContent,
    restoredChordTrack,
    addedChordEvent,
    movedChordEvent,
    updatedChordEvent,
    removedChordEvent,
    createdAdjustmentLayer,
    addedAdjustmentRegion,
    restoredAdjustmentLayers,
    adjustmentRegionNamed,
    adjustmentLayerNamed,
    duplicatedClipAfterItself,
    duplicatedClipToNextBar,
    trackContent,
    clipsShiftedByRippleDelete,
    importedStems,
    insertedAutomationLanePoints,
    insertedTime,
    deletedTime,
};
