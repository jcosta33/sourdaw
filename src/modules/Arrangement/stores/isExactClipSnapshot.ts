import { hasValidAudioSourceState } from '#/utils/audioSourceTime';
import { isRecord } from '#/utils/structuralEquality';

import type { Clip } from '../models/Track';

function isFiniteNumber(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value);
}

function optionalField(value: Record<string, unknown>, key: string, accepts: (field: unknown) => boolean): boolean {
    return !Object.hasOwn(value, key) || value[key] === undefined || accepts(value[key]);
}

function isKneadBlob(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        isFiniteNumber(value.startTime) &&
        isFiniteNumber(value.endTime) &&
        isFiniteNumber(value.pitchCenterCents) &&
        optionalField(value, 'originalPitchCenterCents', isFiniteNumber) &&
        Array.isArray(value.pitchCurveCents) &&
        value.pitchCurveCents.every(isFiniteNumber) &&
        isFiniteNumber(value.voicedConfidence) &&
        Object.keys(value).every((key) =>
            [
                'id',
                'startTime',
                'endTime',
                'pitchCenterCents',
                'originalPitchCenterCents',
                'pitchCurveCents',
                'voicedConfidence',
            ].includes(key)
        )
    );
}

function isKneadState(value: unknown): boolean {
    return (
        isRecord(value) &&
        Array.isArray(value.blobs) &&
        value.blobs.every(isKneadBlob) &&
        isFiniteNumber(value.retuneSpeedMs) &&
        isFiniteNumber(value.humanizePercent) &&
        typeof value.formantPreserve === 'boolean' &&
        Object.keys(value).every((key) =>
            ['blobs', 'retuneSpeedMs', 'humanizePercent', 'formantPreserve'].includes(key)
        )
    );
}

const optionalClipFields: Record<string, (value: unknown) => boolean> = {
    audioBufferId: (value) => typeof value === 'string',
    fileId: (value) => typeof value === 'string',
    assetHash: (value) => typeof value === 'string',
    audioOffsetBeats: isFiniteNumber,
    audioOffsetSeconds: isFiniteNumber,
    audioUnwrappedOffsetSeconds: isFiniteNumber,
    audioLoopStartSeconds: isFiniteNumber,
    audioLoopPassEntrySeconds: isFiniteNumber,
    audioLoopPassOriginBeat: isFiniteNumber,
    midiOffsetBeats: isFiniteNumber,
    stretchMode: (value) => value === 'off' || value === 'repitch' || value === 'timestretch',
    stretchRatio: isFiniteNumber,
    loopEnabled: (value) => typeof value === 'boolean',
    loopLength: isFiniteNumber,
    loopOriginBeat: isFiniteNumber,
    followAction: (value) =>
        value === 'stop' ||
        value === 'play_next' ||
        value === 'play_previous' ||
        value === 'play_random' ||
        value === 'play_first' ||
        value === 'play_last',
    generating: (value) => typeof value === 'boolean',
    isGhost: (value) => typeof value === 'boolean',
    isInlineEditing: (value) => typeof value === 'boolean',
    parentClipId: (value) => typeof value === 'string',
    isLinkedInstance: (value) => typeof value === 'boolean',
    sourceKeyRoot: isFiniteNumber,
    sourceScaleName: (value) => typeof value === 'string',
    overrides: (value) => isRecord(value) && Object.values(value).every((entry) => typeof entry === 'boolean'),
    kneadState: isKneadState,
};

const requiredClipFields = new Set([
    'id',
    'trackId',
    'name',
    'startBeat',
    'endBeat',
    'type',
    'fadeInBeats',
    'fadeOutBeats',
    'gain',
    'color',
    'locked',
    'muted',
]);

function hasValidClipFields(value: Record<string, unknown>): boolean {
    return (
        hasValidAudioSourceState(value) &&
        Object.entries(value).every(
            ([key, field]) =>
                requiredClipFields.has(key) ||
                (Object.hasOwn(optionalClipFields, key) && (field === undefined || optionalClipFields[key]!(field)))
        )
    );
}

export function isExactClipSnapshot(value: unknown, clipId: string, trackId: string): value is Clip {
    return (
        isRecord(value) &&
        value.id === clipId &&
        value.trackId === trackId &&
        typeof value.name === 'string' &&
        typeof value.startBeat === 'number' &&
        Number.isFinite(value.startBeat) &&
        value.startBeat >= 0 &&
        typeof value.endBeat === 'number' &&
        Number.isFinite(value.endBeat) &&
        value.endBeat > value.startBeat &&
        (value.type === 'audio' || value.type === 'midi') &&
        isFiniteNumber(value.fadeInBeats) &&
        isFiniteNumber(value.fadeOutBeats) &&
        isFiniteNumber(value.gain) &&
        typeof value.color === 'string' &&
        typeof value.locked === 'boolean' &&
        typeof value.muted === 'boolean' &&
        hasValidClipFields(value)
    );
}
