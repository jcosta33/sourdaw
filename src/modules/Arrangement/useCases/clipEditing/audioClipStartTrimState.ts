import {
    readBeatAtSamples,
    readSecondsAtBeat,
    readTempoAtBeat,
    tempoMapStore,
    transportStore,
} from '#/modules/Transport/stores';
import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { hasExactAudioSourceFields } from '#/utils/hasExactAudioSourceFields';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';
import { type TempoSourceClock } from '#/utils/tempoAudioSourcePromotion';
import { DEFAULT_TEMPO_BPM } from '#/utils/tempoDefaults';
import { readTempoMapRows } from '#/utils/tempoMapRowPlan';

import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip } from '../../models/Track';
import { isExactClipSnapshot } from '../../stores/isExactClipSnapshot';

import { audioClipTrimTakeSources } from './audioClipTrimTakeSources';
import { prepareAudioClipStartTrim } from './prepareAudioClipStartTrim';

type RestoreAction = Extract<AppAction, { type: 'restoreAudioClipStartTrim' }>;
type DecodedTrim = Omit<RestoreAction['payload'], 'before' | 'after'> & { before: Clip; after: Clip };

const audioClipStartTrimOptionalFields = [
    'audioOffsetBeats',
    'audioOffsetSeconds',
    'audioUnwrappedOffsetSeconds',
    'audioLoopStartSeconds',
    'audioLoopPassEntrySeconds',
    'audioLoopPassOriginBeat',
    'loopOriginBeat',
    'loopLength',
] as const;

const guardedFields = [
    ...audioClipStartTrimOptionalFields,
    'startBeat',
    'id',
    'trackId',
    'type',
    'audioBufferId',
    'fileId',
    'assetHash',
    'endBeat',
    'loopEnabled',
    'stretchMode',
    'stretchRatio',
] as const;

function captureAudioClipTrimClock(): TempoSourceClock {
    return {
        tempo: transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM,
        changes: structuredClone(tempoMapStore.value?.changes ?? []),
    };
}

function audioClipTrimTimeline(clock: TempoSourceClock): TempoTimeline {
    return {
        secondsAtBeat: (beat) => readSecondsAtBeat({ beat, clock }),
        beatAtSeconds: (seconds) => readBeatAtSamples({ samples: seconds, sampleRate: 1, clock }),
        tempoAtBeat: (beat) => readTempoAtBeat({ beat, clock }),
    };
}

function fields(clip: Clip): Record<string, unknown> {
    return Object.fromEntries(guardedFields.filter((key) => Object.hasOwn(clip, key)).map((key) => [key, clip[key]]));
}

function audioClipTrimExpectedMatches(live: Clip, expected: Clip): boolean {
    return !live.locked && hasExactAudioSourceFields(live) && valuesEqual(fields(live), fields(expected));
}

function validClock(value: unknown): value is TempoSourceClock {
    if (!isRecord(value) || typeof value.tempo !== 'number' || !Number.isFinite(value.tempo) || value.tempo <= 0) {
        return false;
    }
    return (
        readTempoMapRows({ tempoMap: { changes: value.changes } }) !== null &&
        Object.keys(value).length === 2 &&
        Object.keys(value).every((key) => key === 'tempo' || key === 'changes')
    );
}

function trimSnapshots(value: Record<string, unknown>): { before: Clip; after: Clip } | null {
    if (typeof value.clipId !== 'string' || !isRecord(value.before) || typeof value.before.trackId !== 'string') {
        return null;
    }
    if (
        !isExactClipSnapshot(value.before, value.clipId, value.before.trackId) ||
        !isExactClipSnapshot(value.after, value.clipId, value.before.trackId)
    ) {
        return null;
    }
    if (
        value.before.type !== 'audio' ||
        value.after.type !== 'audio' ||
        !hasExactAudioSourceFields(value.before) ||
        !hasExactAudioSourceFields(value.after)
    ) {
        return null;
    }
    return { before: value.before, after: value.after };
}

/** Captured history is trusted prior state; prove its exact lawful forward relation, not lost historical values. */
function decodeAudioClipStartTrimPayload(value: unknown): DecodedTrim | null {
    if (
        !isRecord(value) ||
        typeof value.clipId !== 'string' ||
        !validClock(value.clock) ||
        (value.direction !== 'apply' && value.direction !== 'restore') ||
        !Object.keys(value).every((key) =>
            ['clipId', 'before', 'after', 'clock', 'direction', 'takeSourceTransitions'].includes(key)
        )
    ) {
        return null;
    }
    const snapshots = trimSnapshots(value);
    if (!snapshots) {
        return null;
    }
    const projected = prepareAudioClipStartTrim(
        snapshots.before,
        snapshots.after.startBeat,
        audioClipTrimTimeline(value.clock)
    );
    if (!projected || !valuesEqual(projected, snapshots.after)) {
        return null;
    }
    const capture: DecodedTrim = { clipId: value.clipId, ...snapshots, clock: value.clock, direction: value.direction };
    if (Object.hasOwn(value, 'takeSourceTransitions')) {
        if (
            !audioClipTrimTakeSources.isValid(
                value.takeSourceTransitions,
                snapshots.before,
                audioClipTrimTimeline(value.clock)
            )
        ) {
            return null;
        }
        capture.takeSourceTransitions = value.takeSourceTransitions;
    }
    return capture;
}

function isAudioClipStartTrimPayload(value: unknown): boolean {
    return decodeAudioClipStartTrimPayload(value) !== null;
}

function sameTrimCapture(inverse: DecodedTrim, redo: DecodedTrim): boolean {
    return (
        valuesEqual(inverse.before, redo.before) &&
        valuesEqual(inverse.after, redo.after) &&
        valuesEqual(inverse.clock, redo.clock) &&
        Object.hasOwn(inverse, 'takeSourceTransitions') === Object.hasOwn(redo, 'takeSourceTransitions') &&
        valuesEqual(inverse.takeSourceTransitions, redo.takeSourceTransitions)
    );
}

function isAudioClipStartTrimSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.inverseAction?.type !== 'restoreAudioClipStartTrim' &&
        entry.redoAction?.type !== 'restoreAudioClipStartTrim'
    ) {
        return true; // Historical scalar trim entries retain their existing contract.
    }
    if (
        entry.action.type !== 'trimClipStart' ||
        entry.inverseAction?.type !== 'restoreAudioClipStartTrim' ||
        entry.redoAction?.type !== 'restoreAudioClipStartTrim'
    ) {
        return false;
    }
    const inverse = decodeAudioClipStartTrimPayload(entry.inverseAction.payload);
    const redo = decodeAudioClipStartTrimPayload(entry.redoAction.payload);
    if (!inverse || !redo || inverse.direction !== 'restore' || redo.direction !== 'apply') {
        return false;
    }
    return (
        sameTrimCapture(inverse, redo) &&
        entry.action.payload.clipId === inverse.clipId &&
        redo.clipId === inverse.clipId &&
        Math.max(0, entry.action.payload.newStartBeat) === inverse.after.startBeat &&
        Object.keys(entry.action.payload).every((key) => key === 'clipId' || key === 'newStartBeat')
    );
}

/** One codec for the captured audio-head transition and its replay contract. */
export const audioClipStartTrimState = {
    optionalFields: audioClipStartTrimOptionalFields,
    captureClock: captureAudioClipTrimClock,
    timeline: audioClipTrimTimeline,
    expectedMatches: audioClipTrimExpectedMatches,
    decodePayload: decodeAudioClipStartTrimPayload,
    isPayload: isAudioClipStartTrimPayload,
    isSessionEntry: isAudioClipStartTrimSessionEntry,
};
