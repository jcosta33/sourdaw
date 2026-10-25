import {
    captureAudioSourceState,
    hasValidAudioPassOrigin,
    hasValidAudioSourceState,
    isAudioSourceSnapshot,
} from './audioSourceTime';
import { projectClipLoopExpansion } from './clipLoopProjection';
import {
    type TempoAudioClipFieldsSnapshot,
    type TempoAudioClipInputsSnapshot,
    type TempoAudioSourcePresenceSnapshot,
    type TempoAudioSourcePromotionSnapshot,
    type TempoAudioTakeFieldsSnapshot,
    type TempoAudioTakeInputsSnapshot,
} from './handlerContract';
import { isRecord, valuesEqual } from './structuralEquality';

type ClipDelta = TempoAudioSourcePromotionSnapshot['clips'][number];
type TakeDelta = TempoAudioSourcePromotionSnapshot['takes'][number];
type RegionDelta = TempoAudioSourcePromotionSnapshot['regions'][number];
type GapDelta = TempoAudioSourcePromotionSnapshot['gaps'][number];

function exactKeys(
    value: unknown,
    required: readonly string[],
    optional: readonly string[] = []
): value is Record<string, unknown> {
    return (
        isRecord(value) &&
        required.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
    );
}
function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}
function id(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}
function optionalNumbers(value: Record<string, unknown>, fields: readonly string[]): boolean {
    return fields.every((field) => !Object.hasOwn(value, field) || finite(value[field]));
}
function optionalType(value: Record<string, unknown>, field: string, type: 'string' | 'boolean'): boolean {
    return !Object.hasOwn(value, field) || typeof value[field] === type;
}
function range(value: Record<string, unknown>, empty = false): boolean {
    return (
        finite(value.startBeat) &&
        value.startBeat >= 0 &&
        finite(value.endBeat) &&
        (empty ? value.endBeat >= value.startBeat : value.endBeat > value.startBeat)
    );
}
function clipFields(value: unknown): value is TempoAudioClipFieldsSnapshot {
    return (
        exactKeys(
            value,
            [],
            [
                'audioOffsetSeconds',
                'audioUnwrappedOffsetSeconds',
                'audioLoopStartSeconds',
                'audioLoopPassEntrySeconds',
                'audioLoopPassOriginBeat',
            ]
        ) &&
        optionalNumbers(value, [
            'audioOffsetSeconds',
            'audioUnwrappedOffsetSeconds',
            'audioLoopStartSeconds',
            'audioLoopPassEntrySeconds',
            'audioLoopPassOriginBeat',
        ]) &&
        hasValidAudioSourceState(value)
    );
}
function clipInputs(value: unknown): value is TempoAudioClipInputsSnapshot {
    return (
        exactKeys(
            value,
            ['startBeat', 'endBeat'],
            [
                'audioBufferId',
                'assetHash',
                'audioOffsetBeats',
                'loopEnabled',
                'loopLength',
                'loopOriginBeat',
                'stretchMode',
                'stretchRatio',
            ]
        ) &&
        range(value, true) &&
        optionalNumbers(value, ['audioOffsetBeats', 'loopLength', 'loopOriginBeat', 'stretchRatio']) &&
        optionalType(value, 'audioBufferId', 'string') &&
        optionalType(value, 'assetHash', 'string') &&
        optionalType(value, 'loopEnabled', 'boolean') &&
        (!Object.hasOwn(value, 'stretchMode') ||
            (typeof value.stretchMode === 'string' && ['off', 'repitch', 'timestretch'].includes(value.stretchMode)))
    );
}
function clipDelta(value: unknown): value is ClipDelta {
    if (
        !exactKeys(value, ['trackId', 'collection', 'alternativeId', 'clipId', 'inputs', 'before', 'after']) ||
        !id(value.trackId) ||
        !id(value.alternativeId) ||
        !id(value.clipId) ||
        (value.collection !== 'active' && value.collection !== 'alternative') ||
        !clipInputs(value.inputs) ||
        !clipFields(value.before) ||
        !clipFields(value.after) ||
        !finite(value.after.audioOffsetSeconds) ||
        !finite(value.after.audioUnwrappedOffsetSeconds)
    ) {
        return false;
    }
    if (
        value.inputs.loopEnabled &&
        (!finite(value.after.audioLoopStartSeconds) ||
            !finite(value.after.audioLoopPassEntrySeconds) ||
            !finite(value.after.audioLoopPassOriginBeat))
    ) {
        return false;
    }
    if (value.before.audioOffsetSeconds !== undefined) {
        const loop = projectClipLoopExpansion({
            clipDurationBeats: value.inputs.endBeat - value.inputs.startBeat,
            configuredLoopLengthBeats: value.inputs.loopLength,
            loopEnabled: value.inputs.loopEnabled ?? false,
        });
        // A canonical record never reads this legacy conversion tempo.
        const expected = captureAudioSourceState({ ...value.inputs, ...value.before }, loop.loopLengthBeats, 120);
        if (!valuesEqual(expected, value.after)) {
            return false;
        }
    }
    return true;
}
function takeInputs(value: unknown): value is TempoAudioTakeInputsSnapshot {
    if (
        !exactKeys(
            value,
            ['startBeat', 'endBeat'],
            ['sourceOffsetBeats', 'passAnchorSeconds', 'passDepthSeconds', 'passSourceEndSeconds']
        ) ||
        !range(value, true) ||
        !optionalNumbers(value, ['sourceOffsetBeats', 'passAnchorSeconds', 'passDepthSeconds', 'passSourceEndSeconds'])
    ) {
        return false;
    }
    if (finite(value.sourceOffsetBeats) && value.sourceOffsetBeats < 0) {
        return false;
    }
    if (value.passAnchorSeconds === undefined && value.passDepthSeconds === undefined) {
        return value.passSourceEndSeconds === undefined;
    }
    return (
        finite(value.sourceOffsetBeats) &&
        finite(value.passAnchorSeconds) &&
        finite(value.passDepthSeconds) &&
        value.passDepthSeconds >= 0 &&
        (value.passSourceEndSeconds === undefined ||
            (finite(value.passSourceEndSeconds) && value.passSourceEndSeconds > value.passDepthSeconds))
    );
}
function takeFields(value: unknown, inputs: TempoAudioTakeInputsSnapshot): value is TempoAudioTakeFieldsSnapshot {
    return (
        exactKeys(value, [], ['sourceOffsetSeconds', 'passOriginBeat', 'passOriginSourceSeconds']) &&
        optionalNumbers(value, ['sourceOffsetSeconds', 'passOriginBeat', 'passOriginSourceSeconds']) &&
        (value.sourceOffsetSeconds === undefined ||
            (finite(value.sourceOffsetSeconds) && value.sourceOffsetSeconds >= 0)) &&
        hasValidAudioPassOrigin({ ...inputs, ...value })
    );
}
function takeDelta(value: unknown): value is TakeDelta {
    if (
        !exactKeys(value, ['trackId', 'laneId', 'takeId', 'clipId', 'inputs', 'before', 'after']) ||
        !id(value.trackId) ||
        !id(value.laneId) ||
        !id(value.takeId) ||
        !id(value.clipId) ||
        !takeInputs(value.inputs) ||
        !takeFields(value.before, value.inputs) ||
        !takeFields(value.after, value.inputs) ||
        valuesEqual(value.before, value.after)
    ) {
        return false;
    }
    if (value.before.sourceOffsetSeconds !== undefined) {
        if (value.after.sourceOffsetSeconds !== value.before.sourceOffsetSeconds) {
            return false;
        }
    } else if (value.inputs.sourceOffsetBeats !== undefined) {
        if (
            !finite(value.after.sourceOffsetSeconds) ||
            (value.inputs.sourceOffsetBeats === 0 && value.after.sourceOffsetSeconds !== 0)
        ) {
            return false;
        }
    } else if (value.after.sourceOffsetSeconds !== undefined) {
        return false;
    }
    if (
        value.before.passOriginBeat !== undefined &&
        (value.after.passOriginBeat !== value.before.passOriginBeat ||
            value.after.passOriginSourceSeconds !== value.before.passOriginSourceSeconds)
    ) {
        return false;
    }
    return (
        value.inputs.passAnchorSeconds === undefined ||
        (finite(value.after.passOriginBeat) && finite(value.after.passOriginSourceSeconds))
    );
}
function presence(value: unknown): value is TempoAudioSourcePresenceSnapshot {
    if (exactKeys(value, ['present']) && value.present === false) {
        return true;
    }
    return exactKeys(value, ['present', 'value']) && value.present === true && isAudioSourceSnapshot(value.value);
}
function sourceDelta(value: unknown, selected: true): value is RegionDelta;
function sourceDelta(value: unknown, selected: false): value is GapDelta;
function sourceDelta(value: unknown, selected: boolean): value is RegionDelta | GapDelta {
    const required = ['trackId', 'laneId', 'clipId', 'startBeat', 'endBeat', 'before', 'after'];
    if (selected) {
        required.push('takeId');
    }
    return (
        exactKeys(value, required) &&
        id(value.trackId) &&
        id(value.laneId) &&
        id(value.clipId) &&
        (!selected || id(value.takeId)) &&
        range(value) &&
        presence(value.before) &&
        presence(value.after) &&
        value.before.present === false &&
        value.after.present === true
    );
}

/** Decode value shape and member coherence only. This grants no source-write authority:
 * the Arrangement owner must reproduce the capture law against the actual project. */
export function isTempoAudioSourcePromotion(value: unknown): value is TempoAudioSourcePromotionSnapshot {
    if (
        !exactKeys(value, ['version', 'clips', 'takes', 'regions', 'gaps', 'gapFieldPresence']) ||
        value.version !== 1
    ) {
        return false;
    }
    const { clips, takes, regions, gaps, gapFieldPresence } = value;
    if (
        !Array.isArray(clips) ||
        !clips.every(clipDelta) ||
        !Array.isArray(takes) ||
        !takes.every(takeDelta) ||
        !Array.isArray(regions) ||
        !regions.every((row): row is RegionDelta => sourceDelta(row, true)) ||
        !Array.isArray(gaps) ||
        !gaps.every((row): row is GapDelta => sourceDelta(row, false)) ||
        !Array.isArray(gapFieldPresence)
    ) {
        return false;
    }
    const clipKeys = new Set<string>();
    const activeAlternatives = new Map<string, string>();
    for (const clip of clips) {
        const key = JSON.stringify([clip.trackId, clip.collection, clip.alternativeId, clip.clipId]);
        if (clipKeys.has(key)) {
            return false;
        }
        clipKeys.add(key);
        if (clip.collection === 'active') {
            const previous = activeAlternatives.get(clip.trackId);
            if (previous !== undefined && previous !== clip.alternativeId) {
                return false;
            }
            activeAlternatives.set(clip.trackId, clip.alternativeId);
        }
    }
    if (
        clips.some(
            (clip) => clip.collection === 'alternative' && activeAlternatives.get(clip.trackId) === clip.alternativeId
        )
    ) {
        return false;
    }
    const takeIds = new Set<string>();
    const laneOwners = new Map<string, string>();
    for (const row of [...takes, ...regions, ...gaps]) {
        const matchingClips = clips.filter((clip) => clip.trackId === row.trackId && clip.clipId === row.clipId);
        if (matchingClips.length !== 1 || (laneOwners.has(row.laneId) && laneOwners.get(row.laneId) !== row.trackId)) {
            return false;
        }
        laneOwners.set(row.laneId, row.trackId);
    }
    for (const take of takes) {
        if (takeIds.has(take.takeId)) {
            return false;
        }
        takeIds.add(take.takeId);
        const clip = clips.find((row) => row.trackId === take.trackId && row.clipId === take.clipId);
        if (
            !clip ||
            (take.before.passOriginBeat === undefined &&
                take.after.passOriginBeat !== undefined &&
                (take.after.passOriginBeat !== clip.inputs.startBeat ||
                    take.after.passOriginSourceSeconds !== clip.after.audioUnwrappedOffsetSeconds))
        ) {
            return false;
        }
    }
    for (const region of regions) {
        const take = takes.find((row) => row.takeId === region.takeId);
        const clip = clips.find((row) => row.trackId === region.trackId && row.clipId === region.clipId);
        if (
            !clip ||
            !region.after.present ||
            region.after.value.startBeat < region.startBeat ||
            region.after.value.startBeat >= region.endBeat ||
            region.startBeat >= clip.inputs.endBeat ||
            region.endBeat <= clip.inputs.startBeat ||
            (take &&
                (take.trackId !== region.trackId ||
                    take.laneId !== region.laneId ||
                    take.clipId !== region.clipId ||
                    take.inputs.passAnchorSeconds !== undefined))
        ) {
            return false;
        }
    }
    const regionEnds = new Map<string, number>();
    for (const region of [...regions].sort((left, right) => left.startBeat - right.startBeat)) {
        if ((regionEnds.get(region.laneId) ?? -Infinity) > region.startBeat) {
            return false;
        }
        regionEnds.set(region.laneId, region.endBeat);
    }
    const gapEnds = new Map<string, number>();
    for (const gap of [...gaps].sort((left, right) => left.startBeat - right.startBeat)) {
        const clip = clips.find((row) => row.trackId === gap.trackId && row.clipId === gap.clipId);
        const key = JSON.stringify([gap.trackId, gap.laneId, gap.clipId]);
        if (
            !clip ||
            gap.startBeat < clip.inputs.startBeat ||
            gap.endBeat > clip.inputs.endBeat ||
            !gap.after.present ||
            gap.after.value.startBeat !== gap.startBeat ||
            (gapEnds.get(key) ?? -Infinity) > gap.startBeat
        ) {
            return false;
        }
        gapEnds.set(key, gap.endBeat);
    }
    const presenceKeys = new Set<string>();
    for (const field of gapFieldPresence) {
        if (
            !exactKeys(field, ['trackId', 'laneId', 'before', 'after']) ||
            !id(field.trackId) ||
            !id(field.laneId) ||
            typeof field.before !== 'boolean' ||
            field.after !== true ||
            presenceKeys.has(field.laneId) ||
            !gaps.some((gap) => gap.laneId === field.laneId && gap.trackId === field.trackId)
        ) {
            return false;
        }
        presenceKeys.add(field.laneId);
    }
    return gaps.every((gap) => presenceKeys.has(gap.laneId));
}
