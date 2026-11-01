import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';
import { type TempoSourceClock } from '#/utils/tempoAudioSourcePromotion';
import { readTempoMapRows } from '#/utils/tempoMapRowPlan';

import { type Take, type TakeLane } from '../../models/TakeLane';
import { type Clip } from '../../models/Track';
import {
    captureBaseGapAudioSources,
    reconcileBaseGapAudioSourceDelta,
    replaceBaseGapAudioSources,
} from '../../stores/baseGapAudioSourceDelta';
import { isExactClipSnapshot } from '../../stores/isExactClipSnapshot';
import { decodeExactTakeLaneSnapshots } from '../../stores/takeLaneStore';

import { audioClipStartTrimState } from './audioClipStartTrimState';
import { prepareAudioClipSlip, type AudioClipSlipSnapshot } from './prepareAudioClipSlip';

type Payload = Extract<AppAction, { type: 'restoreAudioClipSlip' }>['payload'];
export type AudioClipSlipCapture = Omit<Payload, 'before' | 'after'> & {
    before: AudioClipSlipSnapshot;
    after: AudioClipSlipSnapshot;
};

const optionalFields = [
    'audioOffsetBeats',
    'audioOffsetSeconds',
    'audioUnwrappedOffsetSeconds',
    'audioLoopStartSeconds',
    'audioLoopPassEntrySeconds',
    'audioLoopPassOriginBeat',
] as const;
const takeFields = [
    'id',
    'clipId',
    'startBeat',
    'endBeat',
    'sourceOffsetBeats',
    'sourceOffsetSeconds',
    'passAnchorSeconds',
    'passDepthSeconds',
    'passSourceEndSeconds',
    'passOriginBeat',
    'passOriginSourceSeconds',
] as const;

function takeSource(take: Take) {
    return Object.fromEntries(takeFields.filter((key) => Object.hasOwn(take, key)).map((key) => [key, take[key]]));
}

function laneSource(lane: TakeLane, clipId: string) {
    const takes = lane.takes.filter((take) => take.clipId === clipId);
    const ids = new Set(takes.map((take) => take.id));
    return {
        id: lane.id,
        trackId: lane.trackId,
        takes: takes.map(takeSource),
        regions: lane.activeCompRegions.filter((region) => ids.has(region.takeId)),
        gaps: (lane.baseGapAudioSources ?? []).filter((tile) => tile.clipId === clipId),
    };
}

function lanesMatch(live: readonly TakeLane[], expected: AudioClipSlipSnapshot): boolean {
    return valuesEqual(
        live.filter((lane) => lane.trackId === expected.clip.trackId).map((lane) => laneSource(lane, expected.clip.id)),
        expected.lanes.map((lane) => laneSource(lane, expected.clip.id))
    );
}

function validClock(value: unknown): value is TempoSourceClock {
    return (
        isRecord(value) &&
        typeof value.tempo === 'number' &&
        Number.isFinite(value.tempo) &&
        value.tempo > 0 &&
        Object.keys(value).length === 2 &&
        Object.hasOwn(value, 'changes') &&
        readTempoMapRows({ tempoMap: { changes: value.changes } }) !== null
    );
}

function snapshot(value: unknown, clipId: string): AudioClipSlipSnapshot | null {
    if (
        !isRecord(value) ||
        Object.keys(value).length !== 2 ||
        !isRecord(value.clip) ||
        typeof value.clip.trackId !== 'string' ||
        !isExactClipSnapshot(value.clip, clipId, value.clip.trackId) ||
        !Array.isArray(value.lanes)
    ) {
        return null;
    }
    const lanes = decodeExactTakeLaneSnapshots(value.lanes);
    return lanes ? { clip: value.clip, lanes } : null;
}

function decodePayload(value: unknown): AudioClipSlipCapture | null {
    if (
        !isRecord(value) ||
        typeof value.clipId !== 'string' ||
        typeof value.offset !== 'number' ||
        !Number.isFinite(value.offset) ||
        !validClock(value.clock) ||
        (value.direction !== 'apply' && value.direction !== 'restore') ||
        Object.keys(value).length !== 6 ||
        !Object.keys(value).every((key) => ['clipId', 'offset', 'before', 'after', 'clock', 'direction'].includes(key))
    ) {
        return null;
    }
    const before = snapshot(value.before, value.clipId);
    const after = snapshot(value.after, value.clipId);
    if (!before || !after) {
        return null;
    }
    const projected = prepareAudioClipSlip(before, value.offset, audioClipStartTrimState.timeline(value.clock));
    if (!projected || !valuesEqual(projected, after)) {
        return null;
    }
    return {
        clipId: value.clipId,
        offset: value.offset,
        before,
        after,
        clock: value.clock,
        direction: value.direction,
    };
}

function isSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (entry.inverseAction?.type !== 'restoreAudioClipSlip' && entry.redoAction?.type !== 'restoreAudioClipSlip') {
        return true;
    }
    if (
        entry.action.type !== 'slipClipContent' ||
        entry.action.payload.clipType !== 'audio' ||
        entry.inverseAction?.type !== 'restoreAudioClipSlip' ||
        entry.redoAction?.type !== 'restoreAudioClipSlip'
    ) {
        return false;
    }
    const inverse = decodePayload(entry.inverseAction.payload);
    const redo = decodePayload(entry.redoAction.payload);
    return (
        inverse !== null &&
        redo !== null &&
        inverse.direction === 'restore' &&
        redo.direction === 'apply' &&
        valuesEqual({ ...inverse, direction: 'apply' }, redo) &&
        entry.action.payload.clipId === inverse.clipId &&
        entry.action.payload.offset === inverse.offset &&
        Object.keys(entry.action.payload).every((key) => ['clipId', 'clipType', 'offset'].includes(key))
    );
}

/** Reconcile only this slip's source owners; live peer rows and unrelated facets survive. */
function projectLanes(
    live: readonly TakeLane[],
    expected: AudioClipSlipSnapshot,
    replacement: AudioClipSlipSnapshot
): TakeLane[] | null {
    if (!lanesMatch(live, expected)) {
        return null;
    }
    const result: TakeLane[] = [];
    for (const lane of live) {
        const from = expected.lanes.find((row) => row.id === lane.id);
        const to = replacement.lanes.find((row) => row.id === lane.id);
        if (!from || !to) {
            result.push(lane);
            continue;
        }
        const takes = lane.takes.map((take) => {
            if (take.clipId !== expected.clip.id) {
                return take;
            }
            const target = to.takes.find((row) => row.id === take.id);
            if (!target) {
                return take;
            }
            const updated = Object.assign({}, take);
            for (const field of ['passOriginBeat', 'passOriginSourceSeconds'] as const) {
                if (Object.hasOwn(target, field)) {
                    updated[field] = target[field];
                } else {
                    delete updated[field];
                }
            }
            return updated;
        });
        const targetIds = new Set(from.takes.filter((take) => take.clipId === expected.clip.id).map((take) => take.id));
        const regions = lane.activeCompRegions.map((region) => {
            if (!targetIds.has(region.takeId)) {
                return region;
            }
            const target = to.activeCompRegions.find(
                (row) =>
                    row.takeId === region.takeId && row.startBeat === region.startBeat && row.endBeat === region.endBeat
            );
            if (!target) {
                return region;
            }
            const updated = Object.assign({}, region);
            if (Object.hasOwn(target, 'audioSource')) {
                updated.audioSource = target.audioSource;
            } else {
                delete updated.audioSource;
            }
            return updated;
        });
        const gaps = reconcileBaseGapAudioSourceDelta(
            captureBaseGapAudioSources(lane),
            captureBaseGapAudioSources(from),
            captureBaseGapAudioSources(to)
        );
        if (!gaps) {
            return null;
        }
        result.push(replaceBaseGapAudioSources({ ...lane, takes, activeCompRegions: regions }, gaps));
    }
    return result;
}

function projectClip(live: Clip, replacement: Clip): Clip {
    const updated = Object.assign({}, live);
    for (const field of optionalFields) {
        if (Object.hasOwn(replacement, field)) {
            updated[field] = replacement[field];
        } else {
            delete updated[field];
        }
    }
    return updated;
}

export const audioClipSlipState = {
    optionalFields,
    decodePayload,
    isPayload: (value: unknown) => decodePayload(value) !== null,
    isSessionEntry,
    lanesMatch,
    projectLanes,
    projectClip,
};
