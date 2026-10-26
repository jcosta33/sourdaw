import { isExactAutomationLaneSnapshots, isExactClipAutomationMoveSnapshots } from '#/modules/Automation/useCases';
import { decodeMidiClipDataSnapshots, isExactMidiClipDataActionSnapshot } from '#/modules/MIDI/useCases';
import { captureAudioSourceState, hasValidAudioSourceTiles } from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import {
    type AppAction,
    type HandlerSessionActionEntry,
    type TakeReKeyLaneTransitionSnapshot,
} from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { decodeExactTakeLaneSnapshots } from '../../stores/takeLaneStore';
import { isExactClipSnapshot as isClipSnapshot } from '../../stores/isExactClipSnapshot';
import { clipSatelliteStateCodec } from '../../useCases/timeOperations/clipSatelliteStateCodec';
import { isReKeyLaneTransition } from '../../useCases/timeOperations/isReKeyLaneTransition';
import { timeOperationRestorePlan } from '../../useCases/timeOperations/prepareTimeOperationStateRestore';
import { reverseRestorePlan } from '../../useCases/timeOperations/reverseRestorePlan';

import type { Clip } from '../../stores/trackStore';
import type { undoRippleDelete } from '../../useCases/rippleDelete/undoRippleDelete';

function hasFiniteNumbers(value: unknown): boolean {
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return value.every(hasFiniteNumbers);
    }
    if (isRecord(value)) {
        return Object.values(value).every(hasFiniteNumbers);
    }
    return true;
}

function optionalField(value: Record<string, unknown>, key: string, accepts: (field: unknown) => boolean): boolean {
    return !Object.hasOwn(value, key) || value[key] === undefined || accepts(value[key]);
}

function isRetiredTakeLane(value: unknown, clipId: string, trackId?: string): boolean {
    if (
        !isRecord(value) ||
        typeof value.laneIndex !== 'number' ||
        !Number.isSafeInteger(value.laneIndex) ||
        value.laneIndex < 0
    ) {
        return false;
    }
    const lane = decodeExactTakeLaneSnapshots([value.lane])?.[0];
    if (!lane || (trackId !== undefined && lane.trackId !== trackId)) {
        return false;
    }
    return (
        optionalField(
            value,
            'retiredTakeIds',
            (ids) =>
                Array.isArray(ids) &&
                ids.every(
                    (id) =>
                        typeof id === 'string' && lane.takes.some((take) => take.id === id && take.clipId === clipId)
                )
        ) &&
        optionalField(
            value,
            'retiredBaseGapAudioSources',
            (tiles) =>
                hasValidAudioSourceTiles(tiles) &&
                tiles.every(
                    (tile) =>
                        tile.clipId === clipId && lane.baseGapAudioSources?.some((saved) => valuesEqual(saved, tile))
                )
        ) &&
        Object.keys(value).every((key) =>
            ['laneIndex', 'lane', 'retiredTakeIds', 'retiredBaseGapAudioSources'].includes(key)
        )
    );
}

function isRetiredTakeLanes(value: unknown, clipId: string, trackId?: string): boolean {
    return Array.isArray(value) && value.every((entry) => isRetiredTakeLane(entry, clipId, trackId));
}

function isRippleDeleteShift(
    value: unknown,
    removedClipId: string,
    trackId: string,
    removed: { startBeat: number; endBeat: number }
): boolean {
    return (
        isRecord(value) &&
        typeof value.clipId === 'string' &&
        value.clipId.length > 0 &&
        value.clipId !== removedClipId &&
        typeof value.origStartBeat === 'number' &&
        Number.isFinite(value.origStartBeat) &&
        typeof value.origEndBeat === 'number' &&
        Number.isFinite(value.origEndBeat) &&
        value.origEndBeat > value.origStartBeat &&
        typeof value.automationDelta === 'number' &&
        Number.isFinite(value.automationDelta) &&
        value.origStartBeat >= removed.endBeat &&
        value.automationDelta === -(removed.endBeat - removed.startBeat) &&
        optionalField(
            value,
            'expectedAutomationLanes',
            (lanes) => isExactClipAutomationMoveSnapshots(lanes) && lanes.every((lane) => lane.trackId === trackId)
        ) &&
        Object.keys(value).every((key) =>
            ['clipId', 'origStartBeat', 'origEndBeat', 'automationDelta', 'expectedAutomationLanes'].includes(key)
        )
    );
}

function isRippleDeleteCapture(value: unknown, clipSnapshot: unknown, clipId: string, trackId: string): boolean {
    if (
        !isRecord(value) ||
        !isRecord(clipSnapshot) ||
        typeof clipSnapshot.startBeat !== 'number' ||
        typeof clipSnapshot.endBeat !== 'number'
    ) {
        return false;
    }
    const removedBounds = { startBeat: clipSnapshot.startBeat, endBeat: clipSnapshot.endBeat };
    const satellites = clipSatelliteStateCodec.decodeEntries(value.clipSatellites);
    return (
        Array.isArray(value.removedClips) &&
        value.removedClips.length === 1 &&
        valuesEqual(value.removedClips[0], clipSnapshot) &&
        Array.isArray(value.shiftedClips) &&
        value.shiftedClips.every((shift) => isRippleDeleteShift(shift, clipId, trackId, removedBounds)) &&
        new Set(value.shiftedClips.map((shift) => (isRecord(shift) ? shift.clipId : undefined))).size ===
            value.shiftedClips.length &&
        satellites !== null &&
        satellites.every((entry) => entry.clipId === clipId) &&
        isExactAutomationLaneSnapshots(value.clipAutomationLanes) &&
        value.clipAutomationLanes.every((lane) => lane.clipId === clipId && lane.trackId === trackId)
    );
}

type RestoreClipPayload = Extract<AppAction, { type: 'restoreClip' }>['payload'];
type ValidatedRestoreClipPayload = Omit<RestoreClipPayload, 'clipSnapshot' | 'ripplePlan'> & {
    clipSnapshot: Clip;
    ripplePlan: Omit<Parameters<typeof undoRippleDelete>[0], 'trackId' | 'retiredTakeLanes'> | null;
};

export function isRestoreClipSessionPayload(value: unknown): value is ValidatedRestoreClipPayload {
    if (!isRecord(value) || typeof value.clipId !== 'string' || typeof value.trackId !== 'string') {
        return false;
    }
    return (
        value.clipId.length > 0 &&
        value.trackId.length > 0 &&
        (value.clipIndex === undefined ||
            (typeof value.clipIndex === 'number' && Number.isSafeInteger(value.clipIndex) && value.clipIndex >= 0)) &&
        isClipSnapshot(value.clipSnapshot, value.clipId, value.trackId) &&
        (value.ripplePlan === null ||
            isRippleDeleteCapture(value.ripplePlan, value.clipSnapshot, value.clipId, value.trackId)) &&
        (!Object.hasOwn(value, 'retiredTakeLanes') ||
            // A move retains the recording lane on its original track. Removal
            // captures takes by clip identity, not by the clip's current host.
            isRetiredTakeLanes(value.retiredTakeLanes, value.clipId)) &&
        ['midiNotesSnapshot', 'midiCcSnapshot', 'midiPitchBendSnapshot'].every((key) => Object.hasOwn(value, key)) &&
        decodeMidiClipDataSnapshots({
            notesSnapshot: value.midiNotesSnapshot,
            controlChangeSnapshot: value.midiCcSnapshot,
            pitchBendSnapshot: value.midiPitchBendSnapshot,
        }) !== null &&
        hasFiniteNumbers(value)
    );
}

export function isRemoveClipSessionPayload(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.clipId === 'string' &&
        value.clipId.length > 0 &&
        (!Object.hasOwn(value, 'ripple') || typeof value.ripple === 'boolean') &&
        Object.keys(value).every((key) => key === 'clipId' || key === 'ripple')
    );
}

export function isRemoveClipSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (entry.action.type !== 'removeClip' || entry.inverseAction?.type !== 'restoreClip') {
        return false;
    }
    return (
        isRemoveClipSessionPayload(entry.action.payload) &&
        entry.action.payload.clipId === entry.inverseAction.payload.clipId &&
        isRestoreClipSessionPayload(entry.inverseAction.payload) &&
        (!entry.redoAction ||
            (entry.redoAction.type === 'removeClip' &&
                isRemoveClipSessionPayload(entry.redoAction.payload) &&
                entry.redoAction.payload.clipId === entry.action.payload.clipId &&
                (entry.action.payload.ripple === undefined ||
                    entry.redoAction.payload.ripple === entry.action.payload.ripple)))
    );
}

function isPlacement(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.trackId === 'string' &&
        value.trackId.length > 0 &&
        typeof value.startBeat === 'number' &&
        Number.isFinite(value.startBeat) &&
        value.startBeat >= 0 &&
        typeof value.endBeat === 'number' &&
        Number.isFinite(value.endBeat) &&
        value.endBeat > value.startBeat &&
        isExactClipAutomationMoveSnapshots(value.automationLanes) &&
        value.automationLanes.every((lane) => lane.trackId === value.trackId) &&
        hasFiniteNumbers(value.automationLanes)
    );
}

export function isRestoreClipPlacementSessionPayload(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.clipId === 'string' &&
        value.clipId.length > 0 &&
        isPlacement(value.expected) &&
        isPlacement(value.replacement)
    );
}

export function isMoveClipSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'moveClip' ||
        entry.inverseAction?.type !== 'restoreClipPlacement' ||
        entry.redoAction?.type !== 'restoreClipPlacement'
    ) {
        return false;
    }
    const action = entry.action.payload;
    const inverse = entry.inverseAction.payload;
    const redo = entry.redoAction.payload;
    return (
        action.clipId === inverse.clipId &&
        action.clipId === redo.clipId &&
        isRestoreClipPlacementSessionPayload(inverse) &&
        isRestoreClipPlacementSessionPayload(redo) &&
        inverse.expected.trackId === action.trackId &&
        inverse.expected.startBeat === action.startBeat &&
        inverse.expected.endBeat === action.startBeat + (inverse.replacement.endBeat - inverse.replacement.startBeat) &&
        valuesEqual(inverse.expected, redo.replacement) &&
        valuesEqual(inverse.replacement, redo.expected)
    );
}

function isSplitSnapshot(value: unknown, clipId: string, rightClipId: string): value is { trackId: string } {
    return (
        isRecord(value) &&
        typeof value.trackId === 'string' &&
        value.trackId.length > 0 &&
        isClipSnapshot(value.leftClip, clipId, value.trackId) &&
        (value.rightClip === null || isClipSnapshot(value.rightClip, rightClipId, value.trackId)) &&
        typeof value.rightClipIndex === 'number' &&
        Number.isSafeInteger(value.rightClipIndex) &&
        value.rightClipIndex >= 0 &&
        optionalField(
            value,
            'audioSourceTempoAtStart',
            (tempo) => typeof tempo === 'number' && Number.isFinite(tempo) && tempo > 0
        ) &&
        isExactMidiClipDataActionSnapshot(value.sourceMidi) &&
        isExactMidiClipDataActionSnapshot(value.rightMidi) &&
        hasFiniteNumbers(value)
    );
}

function splitSnapshotCaptureOwnersMatch(value: Record<string, unknown>, clipId: string, rightClipId: string): boolean {
    if (
        !isRecord(value.leftClip) ||
        value.leftClip.id !== clipId ||
        value.leftClip.trackId !== value.trackId ||
        (value.rightClip !== null &&
            (!isRecord(value.rightClip) ||
                value.rightClip.id !== rightClipId ||
                value.rightClip.trackId !== value.trackId))
    ) {
        return false;
    }
    if (value.clipAutomationLanes !== undefined) {
        if (
            !isExactAutomationLaneSnapshots(value.clipAutomationLanes) ||
            !value.clipAutomationLanes.every((lane) => lane.clipId === rightClipId && lane.trackId === value.trackId)
        ) {
            return false;
        }
    }
    if (value.clipSatellites === undefined) {
        return true;
    }
    const satellites = clipSatelliteStateCodec.decodeEntries(value.clipSatellites);
    return (
        satellites !== null &&
        satellites.every(
            (entry) =>
                (entry.clipId === clipId || entry.clipId === rightClipId) &&
                (value.rightClip !== null ||
                    entry.clipId !== rightClipId ||
                    (entry.gainEnvelope === null && entry.warpState === null))
        )
    );
}

function splitLeftSourceMatches(expected: Record<string, unknown>, replacement: Record<string, unknown>): boolean {
    const left = expected.leftClip;
    const otherLeft = replacement.leftClip;
    if (!isRecord(left) || !isRecord(otherLeft)) {
        return false;
    }
    // Historical splits changed only these fields. New audio captures prove
    // their additional source promotion against the stored old governing tempo.
    const preservedFields = (clip: Record<string, unknown>): Record<string, unknown> =>
        Object.fromEntries(
            Object.entries(clip).filter(([key]) => key !== 'name' && key !== 'endBeat' && key !== 'fadeOutBeats')
        );
    if (expected.audioSourceTempoAtStart === undefined && replacement.audioSourceTempoAtStart === undefined) {
        return valuesEqual(preservedFields(left), preservedFields(otherLeft));
    }
    const tempo = expected.audioSourceTempoAtStart;
    if (
        typeof tempo !== 'number' ||
        !Number.isFinite(tempo) ||
        tempo <= 0 ||
        tempo !== replacement.audioSourceTempoAtStart
    ) {
        return false;
    }
    const original = expected.rightClip === null ? expected : replacement;
    const split = expected.rightClip === null ? replacement : expected;
    if (
        original.rightClip !== null ||
        split.rightClip === null ||
        typeof original.trackId !== 'string' ||
        !isRecord(original.leftClip) ||
        typeof original.leftClip.id !== 'string' ||
        !isClipSnapshot(original.leftClip, original.leftClip.id, original.trackId) ||
        original.leftClip.type !== 'audio' ||
        !isRecord(split.leftClip)
    ) {
        return false;
    }
    const clip = original.leftClip;
    const loop = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const source = captureAudioSourceState(clip, loop.loopLengthBeats, tempo);
    if (!source) {
        return false;
    }
    const promoted = {
        ...clip,
        ...source,
    };
    if (clip.loopEnabled) {
        promoted.loopLength = loop.loopLengthBeats;
        promoted.loopOriginBeat = clip.loopOriginBeat ?? clip.startBeat;
    }
    return valuesEqual(preservedFields(promoted), preservedFields(split.leftClip));
}

/** Capture ownership is structural; live owner freshness is checked at replay. */
export function clipSplitCaptureOwnersMatch(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.clipId === 'string' &&
        typeof value.rightClipId === 'string' &&
        isRecord(value.expected) &&
        isRecord(value.replacement) &&
        value.expected.trackId === value.replacement.trackId &&
        Object.hasOwn(value.expected, 'clipSatellites') === Object.hasOwn(value.replacement, 'clipSatellites') &&
        Object.hasOwn(value.expected, 'clipAutomationLanes') ===
            Object.hasOwn(value.replacement, 'clipAutomationLanes') &&
        (value.expected.clipSatellites === undefined) === (value.replacement.clipSatellites === undefined) &&
        (value.expected.clipAutomationLanes === undefined) === (value.replacement.clipAutomationLanes === undefined) &&
        typeof value.expected.trackId === 'string' &&
        splitSnapshotCaptureOwnersMatch(value.expected, value.clipId, value.rightClipId) &&
        splitSnapshotCaptureOwnersMatch(value.replacement, value.clipId, value.rightClipId) &&
        splitLeftSourceMatches(value.expected, value.replacement) &&
        isSplitTakeReKeyCapture(value.reKeyedTakeLanes, value.expected.trackId, value.clipId, value.rightClipId)
    );
}

function foreignTakesUnchanged(
    takes: ReadonlyArray<TakeReKeyLaneTransitionSnapshot['takesBefore'][number]>,
    otherTakes: ReadonlyArray<TakeReKeyLaneTransitionSnapshot['takesAfter'][number]>,
    clipId: string,
    rightClipId: string
): boolean {
    return takes.every(
        (take) =>
            take.clipId === clipId ||
            take.clipId === rightClipId ||
            valuesEqual(
                take,
                otherTakes.find((other) => other.id === take.id)
            )
    );
}

function foreignRegionsUnchanged(
    regions: ReadonlyArray<TakeReKeyLaneTransitionSnapshot['regionsBefore'][number]>,
    otherRegions: ReadonlyArray<TakeReKeyLaneTransitionSnapshot['regionsAfter'][number]>,
    takes: ReadonlyArray<TakeReKeyLaneTransitionSnapshot['takesBefore'][number]>,
    clipId: string,
    rightClipId: string
): boolean {
    return regions.every((region) => {
        const take = takes.find((candidate) => candidate.id === region.takeId);
        return (
            take?.clipId === clipId ||
            take?.clipId === rightClipId ||
            otherRegions.some((other) => valuesEqual(region, other))
        );
    });
}

function isSplitTakeReKeyCapture(value: unknown, trackId: string, clipId: string, rightClipId: string): boolean {
    if (value === undefined) {
        return true;
    }
    if (!Array.isArray(value) || !value.every(isReKeyLaneTransition)) {
        return false;
    }
    const laneIds = new Set<string>();
    for (const transition of value) {
        if (transition.trackId !== trackId || laneIds.has(transition.laneId)) {
            return false;
        }
        laneIds.add(transition.laneId);
        const foreignBefore = (transition.baseGapAudioSourcesBefore ?? []).filter(
            (tile) => tile.clipId !== clipId && tile.clipId !== rightClipId
        );
        const foreignAfter = (transition.baseGapAudioSourcesAfter ?? []).filter(
            (tile) => tile.clipId !== clipId && tile.clipId !== rightClipId
        );
        if (
            !valuesEqual(foreignBefore, foreignAfter) ||
            !foreignTakesUnchanged(transition.takesBefore, transition.takesAfter, clipId, rightClipId) ||
            !foreignTakesUnchanged(transition.takesAfter, transition.takesBefore, clipId, rightClipId) ||
            !foreignRegionsUnchanged(
                transition.regionsBefore,
                transition.regionsAfter,
                transition.takesBefore,
                clipId,
                rightClipId
            ) ||
            !foreignRegionsUnchanged(
                transition.regionsAfter,
                transition.regionsBefore,
                transition.takesAfter,
                clipId,
                rightClipId
            )
        ) {
            return false;
        }
    }
    return true;
}

export function isRestoreClipSplitSessionPayload(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.clipId === 'string' &&
        value.clipId.length > 0 &&
        typeof value.rightClipId === 'string' &&
        value.rightClipId.length > 0 &&
        value.rightClipId !== value.clipId &&
        isSplitSnapshot(value.expected, value.clipId, value.rightClipId) &&
        isSplitSnapshot(value.replacement, value.clipId, value.rightClipId) &&
        clipSplitCaptureOwnersMatch(value) &&
        (value.retiredTakeLanes === undefined ||
            (isRetiredTakeLanes(value.retiredTakeLanes, value.rightClipId, value.expected.trackId) &&
                isRetiredTakeLanes(value.retiredTakeLanes, value.rightClipId, value.replacement.trackId)))
    );
}

function splitReplaySnapshotsMatch(
    inverse: Extract<AppAction, { type: 'restoreClipSplitState' }>['payload'],
    redo: Extract<AppAction, { type: 'restoreClipSplitState' }>['payload']
): boolean {
    return (
        valuesEqual(inverse.expected, redo.replacement) &&
        valuesEqual(inverse.replacement, redo.expected) &&
        valuesEqual(inverse.retiredTakeLanes, redo.retiredTakeLanes) &&
        valuesEqual(inverse.reKeyedTakeLanes, redo.reKeyedTakeLanes)
    );
}

export function isSplitClipSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'splitClip' ||
        entry.inverseAction?.type !== 'restoreClipSplitState' ||
        entry.redoAction?.type !== 'restoreClipSplitState'
    ) {
        return false;
    }
    const action = entry.action.payload;
    const inverse = entry.inverseAction.payload;
    const redo = entry.redoAction.payload;
    return (
        action.clipId === inverse.clipId &&
        action.clipId === redo.clipId &&
        action.rightClipId === inverse.rightClipId &&
        action.rightClipId === redo.rightClipId &&
        isRestoreClipSplitSessionPayload(inverse) &&
        isRestoreClipSplitSessionPayload(redo) &&
        typeof action.resolvedBeat === 'number' &&
        Number.isFinite(action.resolvedBeat) &&
        inverse.expected.rightClip !== null &&
        inverse.replacement.rightClip === null &&
        inverse.expected.leftClip.endBeat === action.resolvedBeat &&
        inverse.expected.rightClip.startBeat === action.resolvedBeat &&
        inverse.replacement.leftClip.startBeat < action.resolvedBeat &&
        inverse.replacement.leftClip.endBeat > action.resolvedBeat &&
        splitReplaySnapshotsMatch(inverse, redo)
    );
}

export function isRestoreTimeOperationSessionPayload(value: unknown): boolean {
    return isRecord(value) && timeOperationRestorePlan.isValid(value.plan);
}

export function isDeleteTimeSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'deleteTime' ||
        entry.inverseAction?.type !== 'restoreTimeOperationState' ||
        entry.redoAction?.type !== 'restoreTimeOperationState'
    ) {
        return false;
    }
    const action = entry.action.payload;
    const inverse = entry.inverseAction.payload;
    const redo = entry.redoAction.payload;
    const inversePlan: unknown = inverse.plan;
    const redoPlan: unknown = redo.plan;
    if (
        !Number.isFinite(action.startBeat) ||
        !Number.isFinite(action.endBeat) ||
        action.startBeat < 0 ||
        action.endBeat <= action.startBeat ||
        !timeOperationRestorePlan.isValid(inversePlan, action) ||
        !timeOperationRestorePlan.isValid(redoPlan, action) ||
        !isRecord(inversePlan) ||
        inversePlan.scope !== 'global' ||
        !isRecord(redoPlan) ||
        redoPlan.scope !== 'global'
    ) {
        return false;
    }
    try {
        return valuesEqual(reverseRestorePlan(inversePlan), redoPlan);
    } catch {
        return false;
    }
}
