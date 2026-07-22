import { type Clip } from '../../models/Track';

type UnknownRecord = Record<string, unknown>;

type ClipCollectionSource =
    | { kind: 'active'; trackId: string; activeAlternativeId: string }
    | { kind: 'alternative'; trackId: string; alternativeId: string };

const STRETCH_MODES = new Set(['off', 'repitch', 'timestretch']);
const FOLLOW_ACTIONS = new Set(['stop', 'play_next', 'play_previous', 'play_random', 'play_first', 'play_last']);

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasFiniteNumbers(record: UnknownRecord, keys: readonly string[]): boolean {
    return keys.every((key) => typeof record[key] === 'number' && Number.isFinite(record[key]));
}

function hasOptionalFiniteNumbers(record: UnknownRecord, keys: readonly string[]): boolean {
    return keys.every(
        (key) => record[key] === undefined || (typeof record[key] === 'number' && Number.isFinite(record[key]))
    );
}

function hasOptionalTypes(record: UnknownRecord, keys: readonly string[], type: 'boolean' | 'string'): boolean {
    return keys.every((key) => record[key] === undefined || typeof record[key] === type);
}

function isBooleanRecord(value: unknown): boolean {
    return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'boolean');
}

function isValidKneadState(value: unknown): boolean {
    if (!isRecord(value) || !Array.isArray(value.blobs)) {
        return false;
    }
    if (!hasFiniteNumbers(value, ['retuneSpeedMs', 'humanizePercent']) || typeof value.formantPreserve !== 'boolean') {
        return false;
    }

    return value.blobs.every((blob) => {
        if (!isRecord(blob) || typeof blob.id !== 'string' || !Array.isArray(blob.pitchCurveCents)) {
            return false;
        }
        if (!hasFiniteNumbers(blob, ['startTime', 'endTime', 'pitchCenterCents', 'voicedConfidence'])) {
            return false;
        }
        if (blob.originalPitchCenterCents !== undefined) {
            if (typeof blob.originalPitchCenterCents !== 'number' || !Number.isFinite(blob.originalPitchCenterCents)) {
                return false;
            }
        }
        return blob.pitchCurveCents.every((point) => typeof point === 'number' && Number.isFinite(point));
    });
}

function isCompleteRuntimeClip(value: unknown, targetTrackId: string): value is Clip {
    if (!isRecord(value)) {
        return false;
    }

    try {
        if (
            typeof value.id !== 'string' ||
            value.id.length === 0 ||
            value.trackId !== targetTrackId ||
            typeof value.name !== 'string' ||
            typeof value.color !== 'string' ||
            (value.type !== 'audio' && value.type !== 'midi') ||
            typeof value.locked !== 'boolean' ||
            typeof value.muted !== 'boolean'
        ) {
            return false;
        }

        const startBeat = value.startBeat;
        const endBeat = value.endBeat;
        const fadeInBeats = value.fadeInBeats;
        const fadeOutBeats = value.fadeOutBeats;
        const gain = value.gain;
        if (
            typeof startBeat !== 'number' ||
            !Number.isFinite(startBeat) ||
            typeof endBeat !== 'number' ||
            !Number.isFinite(endBeat) ||
            typeof fadeInBeats !== 'number' ||
            !Number.isFinite(fadeInBeats) ||
            typeof fadeOutBeats !== 'number' ||
            !Number.isFinite(fadeOutBeats) ||
            typeof gain !== 'number' ||
            !Number.isFinite(gain)
        ) {
            return false;
        }
        if (endBeat <= startBeat || fadeInBeats < 0 || fadeOutBeats < 0) {
            return false;
        }
        if (
            !hasOptionalFiniteNumbers(value, [
                'audioOffsetBeats',
                'midiOffsetBeats',
                'stretchRatio',
                'loopLength',
                'sourceKeyRoot',
            ])
        ) {
            return false;
        }
        if (!hasOptionalTypes(value, ['audioBufferId', 'assetHash', 'parentClipId', 'sourceScaleName'], 'string')) {
            return false;
        }
        if (
            !hasOptionalTypes(
                value,
                ['loopEnabled', 'generating', 'isGhost', 'isInlineEditing', 'isLinkedInstance'],
                'boolean'
            )
        ) {
            return false;
        }
        if (value.stretchMode !== undefined) {
            if (typeof value.stretchMode !== 'string' || !STRETCH_MODES.has(value.stretchMode)) {
                return false;
            }
        }
        if (value.followAction !== undefined) {
            if (typeof value.followAction !== 'string' || !FOLLOW_ACTIONS.has(value.followAction)) {
                return false;
            }
        }
        if (value.overrides !== undefined && !isBooleanRecord(value.overrides)) {
            return false;
        }
        if (value.kneadState !== undefined && !isValidKneadState(value.kneadState)) {
            return false;
        }
    } catch {
        return false;
    }

    return true;
}

function collectionContainsSelectedId(value: unknown, selectedIds: Set<string>): boolean | null {
    if (!Array.isArray(value)) {
        return null;
    }

    for (const candidate of value) {
        if (!isRecord(candidate) || typeof candidate.id !== 'string' || candidate.id.length === 0) {
            return null;
        }
        if (selectedIds.has(candidate.id)) {
            return true;
        }
    }

    return false;
}

function hasExternalClipIdCollision(tracks: unknown, selectedIds: Set<string>, source: ClipCollectionSource): boolean {
    if (!Array.isArray(tracks)) {
        return true;
    }

    try {
        for (const track of tracks) {
            if (!isRecord(track) || typeof track.id !== 'string' || !Array.isArray(track.alternatives)) {
                return true;
            }

            const skipActiveCollection = source.kind === 'active' && track.id === source.trackId;
            if (!skipActiveCollection) {
                const activeCollision = collectionContainsSelectedId(track.clips, selectedIds);
                if (activeCollision === null || activeCollision) {
                    return true;
                }
            }

            for (const alternative of track.alternatives) {
                if (!isRecord(alternative) || typeof alternative.id !== 'string') {
                    return true;
                }
                const isSelectedAlternative =
                    source.kind === 'alternative' &&
                    track.id === source.trackId &&
                    alternative.id === source.alternativeId;
                const isActiveSnapshot =
                    source.kind === 'active' &&
                    track.id === source.trackId &&
                    alternative.id === source.activeAlternativeId;
                if (isSelectedAlternative || isActiveSnapshot) {
                    continue;
                }

                const alternativeCollision = collectionContainsSelectedId(alternative.clips, selectedIds);
                if (alternativeCollision === null || alternativeCollision) {
                    return true;
                }
            }
        }
    } catch {
        return true;
    }

    return false;
}

export function isPromotableRuntimeClipCollection({
    value,
    targetTrackId,
    tracks,
    source,
}: {
    value: unknown;
    targetTrackId: string;
    tracks: unknown;
    source: ClipCollectionSource;
}): boolean {
    if (!Array.isArray(value)) {
        return false;
    }

    const selectedIds = new Set<string>();
    for (const candidate of value) {
        if (!isCompleteRuntimeClip(candidate, targetTrackId) || selectedIds.has(candidate.id)) {
            return false;
        }
        selectedIds.add(candidate.id);
    }

    return !hasExternalClipIdCollision(tracks, selectedIds, source);
}
