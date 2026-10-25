import { resolveClipLoopOriginAdvance } from './clipLoopOrigin';
import { isRecord } from './structuralEquality';
import { boundStretchRatio } from './stretchRatioBound';

type AudioSourceOffset = {
    audioOffsetSeconds?: number;
    audioUnwrappedOffsetSeconds?: number;
    audioOffsetBeats?: number;
};

/** Signed source entry; canonical zero is authoritative. Legacy beats use the clip-start tempo. */
export function resolveAudioSourceOffsetSeconds(offset: AudioSourceOffset, tempoAtClipStart: number): number {
    if (offset.audioOffsetSeconds !== undefined) {
        return offset.audioOffsetSeconds;
    }
    if (!Number.isFinite(tempoAtClipStart) || tempoAtClipStart <= 0) {
        return 0;
    }
    return (offset.audioOffsetBeats ?? 0) * (60 / tempoAtClipStart);
}

/** Fresh canonical data defaults its unwrapped media entry to E; legacy data uses q*B. */
export function resolveAudioUnwrappedOffsetSeconds(offset: AudioSourceOffset, tempoAtClipStart: number): number {
    return offset.audioUnwrappedOffsetSeconds ?? resolveAudioSourceOffsetSeconds(offset, tempoAtClipStart);
}

type AudioSourceTimeline = {
    secondsAtBeat: (beat: number) => number;
    beatAtSeconds: (seconds: number) => number;
    tempoAtBeat: (beat: number) => number;
};

type AudioTakeSource = {
    sourceOffsetBeats?: number;
    sourceOffsetSeconds?: number;
    passAnchorSeconds?: number;
    passDepthSeconds?: number;
    passSourceEndSeconds?: number;
    passOriginBeat?: number;
    passOriginSourceSeconds?: number;
};

/** Physical take media shared by live and offline comp resolution. */
export function resolveAudioTakeSource(
    take: AudioTakeSource,
    clip: AudioSourceOffset & { startBeat: number; stretchMode?: string; stretchRatio?: number },
    timeline: AudioSourceTimeline
) {
    const rate = clip.stretchMode && clip.stretchMode !== 'off' ? boundStretchRatio(clip.stretchRatio ?? 1) : 1;
    if (take.passAnchorSeconds !== undefined && take.passDepthSeconds !== undefined) {
        // Old placed records retain their historical constant-span shortcut until
        // a producer captures the original basis. Do not infer it after a cut.
        if (take.passOriginBeat === undefined || take.passOriginSourceSeconds === undefined) {
            return null;
        }
        const startSeconds =
            timeline.secondsAtBeat(take.passOriginBeat) +
            (take.passAnchorSeconds - take.passOriginSourceSeconds) / rate;
        const passStart = timeline.beatAtSeconds(startSeconds);
        const depth = take.passDepthSeconds;
        const offsetSecondsAt = (beat: number) => depth + (timeline.secondsAtBeat(beat) - startSeconds) * rate;
        const sourceEnd = take.passSourceEndSeconds;
        const physical = {
            earliestBeat: Math.max(clip.startBeat, passStart),
            sourceStartBeat: passStart - (depth * timeline.tempoAtBeat(passStart)) / (60 * rate),
            offsetAt: (beat: number) => (offsetSecondsAt(beat) * timeline.tempoAtBeat(beat)) / 60,
            offsetSecondsAt,
        };
        if (sourceEnd === undefined) {
            return physical;
        }
        return {
            ...physical,
            latestBeatAt: (beat: number) => {
                const remaining = sourceEnd - offsetSecondsAt(beat);
                if (remaining <= 0) {
                    return beat;
                }
                return timeline.beatAtSeconds(timeline.secondsAtBeat(beat) + remaining / rate);
            },
        };
    }
    const tempo = timeline.tempoAtBeat(clip.startBeat);
    const depth = take.sourceOffsetSeconds ?? ((take.sourceOffsetBeats ?? 0) * 60) / tempo;
    const entry = resolveAudioUnwrappedOffsetSeconds(clip, tempo) + depth;
    const offsetSecondsAt = (beat: number) =>
        entry + timeline.secondsAtBeat(beat) - timeline.secondsAtBeat(clip.startBeat);
    return {
        earliestBeat: clip.startBeat,
        sourceStartBeat: clip.startBeat - (take.sourceOffsetBeats ?? 0),
        offsetAt: (beat: number) => (offsetSecondsAt(beat) * timeline.tempoAtBeat(beat)) / 60,
        offsetSecondsAt,
    };
}

export function getAudioSourcePositionSeconds(
    sourceOffsetSeconds: number,
    elapsedTimelineSeconds: number,
    stretchRatio: number
): number {
    return sourceOffsetSeconds + boundStretchRatio(stretchRatio) * elapsedTimelineSeconds;
}

export function getAudioTimelineElapsedSeconds(
    sourceOffsetSeconds: number,
    sourcePositionSeconds: number,
    stretchRatio: number
): number {
    return (sourcePositionSeconds - sourceOffsetSeconds) / boundStretchRatio(stretchRatio);
}

type LoopedAudioSource = AudioSourceOffset & {
    startBeat: number;
    loopOriginBeat?: number;
    loopEnabled?: boolean;
    audioLoopStartSeconds?: number;
    audioLoopPassEntrySeconds?: number;
    audioLoopPassOriginBeat?: number;
};

type AudioSourceState = {
    audioOffsetSeconds: number;
    audioUnwrappedOffsetSeconds: number;
    audioLoopStartSeconds?: number;
    audioLoopPassEntrySeconds?: number;
    audioLoopPassOriginBeat?: number;
};

/** Physical source basis retained independently of a clipped window's visible extent. */
export type AudioSourceSnapshot = {
    readonly startBeat: number;
    readonly audioOffsetSeconds: number;
    readonly audioLoopStartSeconds: number;
    readonly audioLoopPassEntrySeconds: number;
    readonly audioLoopPassOriginBeat: number;
    readonly loopOriginBeat: number;
    readonly loopLength: number;
};

export type AudioSourceTile = {
    readonly clipId: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly audioSource: AudioSourceSnapshot;
};

export function isAudioSourceTile(value: unknown): value is AudioSourceTile {
    return (
        isRecord(value) &&
        Object.keys(value).length === 4 &&
        typeof value.clipId === 'string' &&
        value.clipId.length > 0 &&
        typeof value.startBeat === 'number' &&
        Number.isFinite(value.startBeat) &&
        value.startBeat >= 0 &&
        typeof value.endBeat === 'number' &&
        Number.isFinite(value.endBeat) &&
        value.endBeat > value.startBeat &&
        isAudioSourceSnapshot(value.audioSource)
    );
}

export function hasValidAudioSourceTiles(value: unknown): value is AudioSourceTile[] {
    if (!Array.isArray(value) || !value.every(isAudioSourceTile)) {
        return false;
    }
    const endByClip = new Map<string, number>();
    for (const tile of value) {
        if (tile.startBeat < (endByClip.get(tile.clipId) ?? -Infinity)) {
            return false;
        }
        endByClip.set(tile.clipId, tile.endBeat);
    }
    return true;
}

/** Partition one audible base gap; tiles on another source clip cannot claim it. */
export function partitionAudioSourceTiles(
    clipId: string,
    startBeat: number,
    endBeat: number,
    tiles: readonly AudioSourceTile[]
): { startBeat: number; endBeat: number; audioSource?: AudioSourceSnapshot }[] {
    const parts: { startBeat: number; endBeat: number; audioSource?: AudioSourceSnapshot }[] = [];
    let cursor = startBeat;
    for (const tile of tiles) {
        if (tile.clipId !== clipId || tile.endBeat <= cursor || tile.startBeat >= endBeat) {
            continue;
        }
        if (tile.startBeat > cursor) {
            parts.push({ startBeat: cursor, endBeat: Math.min(tile.startBeat, endBeat) });
        }
        const end = Math.min(tile.endBeat, endBeat);
        parts.push({ startBeat: Math.max(cursor, tile.startBeat), endBeat: end, audioSource: tile.audioSource });
        cursor = end;
    }
    if (cursor < endBeat) {
        parts.push({ startBeat: cursor, endBeat });
    }
    return parts;
}

/** Capture the actual resolved fragment, including its independent repeat grid. */
export function captureAudioSourceSnapshot(
    clip: LoopedAudioSource,
    loopLength: number,
    tempo: number
): AudioSourceSnapshot | null {
    const source = captureAudioSourceState(clip, loopLength, tempo);
    if (!source || !(Number.isFinite(loopLength) && loopLength > 0)) {
        return null;
    }
    return {
        startBeat: clip.startBeat,
        audioOffsetSeconds: source.audioOffsetSeconds,
        audioLoopStartSeconds: source.audioLoopStartSeconds ?? source.audioOffsetSeconds,
        audioLoopPassEntrySeconds: source.audioLoopPassEntrySeconds ?? source.audioOffsetSeconds,
        audioLoopPassOriginBeat: source.audioLoopPassOriginBeat ?? clip.startBeat,
        loopOriginBeat: clip.loopOriginBeat ?? clip.startBeat,
        loopLength,
    };
}

/** Rebase only the visible entry; the captured repeat seams remain stationary. */
export function audioSourceSnapshotAtBeat(
    snapshot: AudioSourceSnapshot,
    beat: number,
    rate: number,
    loopEnabled: boolean,
    secondsAtBeat: (beat: number) => number
) {
    const part = projectAudioLoopPassSegments({
        clip: { ...snapshot, loopEnabled },
        loopLengthBeats: snapshot.loopLength,
        iterationStartBeat: beat,
        iterationEndBeat: beat + snapshot.loopLength,
        stretchRatio: rate,
        // Every snapshot is canonical; no legacy conversion reads this tempo.
        tempoAtClipStart: 120,
        secondsAtBeat,
    })[0];
    if (!part) {
        return null;
    }
    const { startBeat: _sourceStart, ...source } = snapshot;
    return { ...source, audioOffsetSeconds: part.sourceStartSeconds };
}

/** A newly resolved take region begins its own pass grid at its actual entry. */
export function audioTakeFragmentSource(entrySeconds: number, startBeat: number) {
    return {
        audioOffsetSeconds: entrySeconds,
        audioUnwrappedOffsetSeconds: entrySeconds,
        audioLoopStartSeconds: entrySeconds,
        audioLoopPassEntrySeconds: entrySeconds,
        audioLoopPassOriginBeat: startBeat,
        loopOriginBeat: startBeat,
    };
}

const sourceSnapshotKeys = [
    'startBeat',
    'audioOffsetSeconds',
    'audioLoopStartSeconds',
    'audioLoopPassEntrySeconds',
    'audioLoopPassOriginBeat',
    'loopOriginBeat',
    'loopLength',
];

export function isAudioSourceSnapshot(value: unknown): value is AudioSourceSnapshot {
    return (
        isRecord(value) &&
        Object.keys(value).length === sourceSnapshotKeys.length &&
        sourceSnapshotKeys.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key])) &&
        typeof value.loopLength === 'number' &&
        value.loopLength > 0
    );
}

/** A placed pass keeps its original clip-media basis when a cut rebases the clip head. */
export function hasValidAudioPassOrigin(value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    const hasBeat = Object.hasOwn(value, 'passOriginBeat');
    const hasSource = Object.hasOwn(value, 'passOriginSourceSeconds');
    if (!hasBeat && !hasSource) {
        return true;
    }
    return (
        hasBeat &&
        hasSource &&
        typeof value.passOriginBeat === 'number' &&
        Number.isFinite(value.passOriginBeat) &&
        typeof value.passOriginSourceSeconds === 'number' &&
        Number.isFinite(value.passOriginSourceSeconds) &&
        typeof value.passAnchorSeconds === 'number' &&
        Number.isFinite(value.passAnchorSeconds) &&
        typeof value.passDepthSeconds === 'number' &&
        Number.isFinite(value.passDepthSeconds) &&
        value.passDepthSeconds >= 0
    );
}

export function hasValidAudioSourceState(value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    const clip = value;
    const provenanceFields = [
        clip.audioUnwrappedOffsetSeconds,
        clip.audioLoopStartSeconds,
        clip.audioLoopPassEntrySeconds,
        clip.audioLoopPassOriginBeat,
    ];
    const fields = [clip.audioOffsetSeconds, ...provenanceFields];
    if (clip.type === 'midi' && fields.some((field) => field !== undefined)) {
        return false;
    }
    if (clip.audioOffsetSeconds === undefined && provenanceFields.some((value) => value !== undefined)) {
        return false;
    }
    return fields.every((field) => field === undefined || (typeof field === 'number' && Number.isFinite(field)));
}

/**
 * Capture physical source anchors under the old governing map. A beat-only
 * loop's published head is W + phase*q, including advances beyond one period.
 * Partial canonical records are fresh regions: missing W/H use E, missing S
 * uses C. These defaults carry no claim about historical phase.
 */
export function captureAudioSourceState(
    clip: LoopedAudioSource,
    loopLengthBeats: number,
    tempoAtClipStart: number
): AudioSourceState | null {
    if (!hasValidAudioSourceState(clip) || !Number.isFinite(clip.startBeat)) {
        return null;
    }
    if (!clip.loopEnabled) {
        const entry = resolveAudioSourceOffsetSeconds(clip, tempoAtClipStart);
        const unwrapped = resolveAudioUnwrappedOffsetSeconds(clip, tempoAtClipStart);
        if (!Number.isFinite(entry) || !Number.isFinite(unwrapped)) {
            return null;
        }
        const state: AudioSourceState = {
            audioOffsetSeconds: entry,
            audioUnwrappedOffsetSeconds: unwrapped,
        };
        if (clip.audioLoopStartSeconds !== undefined) {
            state.audioLoopStartSeconds = clip.audioLoopStartSeconds;
        }
        if (clip.audioLoopPassEntrySeconds !== undefined) {
            state.audioLoopPassEntrySeconds = clip.audioLoopPassEntrySeconds;
        }
        if (clip.audioLoopPassOriginBeat !== undefined) {
            state.audioLoopPassOriginBeat = clip.audioLoopPassOriginBeat;
        }
        return state;
    }
    if (!(Number.isFinite(loopLengthBeats) && loopLengthBeats > 0)) {
        return null;
    }
    if (clip.audioOffsetSeconds !== undefined) {
        return {
            audioOffsetSeconds: clip.audioOffsetSeconds,
            audioUnwrappedOffsetSeconds: resolveAudioUnwrappedOffsetSeconds(clip, tempoAtClipStart),
            audioLoopStartSeconds: clip.audioLoopStartSeconds ?? clip.audioOffsetSeconds,
            audioLoopPassEntrySeconds: clip.audioLoopPassEntrySeconds ?? clip.audioOffsetSeconds,
            audioLoopPassOriginBeat: clip.audioLoopPassOriginBeat ?? clip.startBeat,
        };
    }
    const advance = resolveClipLoopOriginAdvance({ ...clip, loopOriginBeat: clip.loopOriginBeat, loopEnabled: true });
    const phase = ((advance % loopLengthBeats) + loopLengthBeats) % loopLengthBeats;
    const reset = resolveAudioSourceOffsetSeconds(
        { audioOffsetBeats: (clip.audioOffsetBeats ?? 0) - advance },
        tempoAtClipStart
    );
    const head = reset + resolveAudioSourceOffsetSeconds({ audioOffsetBeats: phase }, tempoAtClipStart);
    const unwrapped = resolveAudioSourceOffsetSeconds(clip, tempoAtClipStart);
    if (!Number.isFinite(reset) || !Number.isFinite(head) || !Number.isFinite(unwrapped)) {
        return null;
    }
    return {
        audioOffsetSeconds: head,
        audioUnwrappedOffsetSeconds: unwrapped,
        audioLoopStartSeconds: reset,
        audioLoopPassEntrySeconds: head,
        audioLoopPassOriginBeat: clip.startBeat,
    };
}

export function resolveAudioLoopStartSeconds(clip: LoopedAudioSource, tempoAtClipStart: number): number {
    if (clip.audioOffsetSeconds !== undefined) {
        return clip.audioLoopStartSeconds ?? clip.audioOffsetSeconds;
    }
    const advance = resolveClipLoopOriginAdvance({
        ...clip,
        loopOriginBeat: clip.loopOriginBeat,
        loopEnabled: clip.loopEnabled ?? false,
    });
    return resolveAudioSourceOffsetSeconds(
        { audioOffsetBeats: (clip.audioOffsetBeats ?? 0) - advance },
        tempoAtClipStart
    );
}

/**
 * Partition one bounded scheduling window on the original pass and wrap grid.
 * A cut window can contain head, wrap, then the next head. The first visible
 * part enters at E; subsequent heads use H and wraps use W, independent of rate.
 */
export function projectAudioLoopPassSegments({
    clip,
    loopLengthBeats,
    iterationStartBeat,
    iterationEndBeat,
    stretchRatio,
    tempoAtClipStart,
    secondsAtBeat,
}: {
    clip: LoopedAudioSource;
    loopLengthBeats: number;
    iterationStartBeat: number;
    iterationEndBeat: number;
    stretchRatio: number;
    tempoAtClipStart: number;
    secondsAtBeat: (beat: number) => number;
}): { startOffsetBeats: number; endOffsetBeats: number; sourceStartSeconds: number }[] {
    const duration = iterationEndBeat - iterationStartBeat;
    const source = captureAudioSourceState(clip, loopLengthBeats, tempoAtClipStart);
    if (!(duration > 0) || !Number.isFinite(duration) || !source) {
        return [];
    }
    if (!clip.loopEnabled) {
        return [
            {
                startOffsetBeats: 0,
                endOffsetBeats: duration,
                sourceStartSeconds: getAudioSourcePositionSeconds(
                    source.audioOffsetSeconds,
                    secondsAtBeat(iterationStartBeat) - secondsAtBeat(clip.startBeat),
                    stretchRatio
                ),
            },
        ];
    }
    const passOrigin = source.audioLoopPassOriginBeat!;
    const headSource = source.audioLoopPassEntrySeconds!;
    const resetSource = source.audioLoopStartSeconds!;
    const advance = resolveClipLoopOriginAdvance({
        ...clip,
        startBeat: passOrigin,
        loopOriginBeat: clip.loopOriginBeat,
        loopEnabled: true,
    });
    const phase = ((advance % loopLengthBeats) + loopLengthBeats) % loopLengthBeats;
    const segments: { startOffsetBeats: number; endOffsetBeats: number; sourceStartSeconds: number }[] = [];
    let cursor = iterationStartBeat;
    let passIndex = Math.floor((cursor - passOrigin) / loopLengthBeats);
    while (cursor < iterationEndBeat) {
        const passStart = passOrigin + passIndex * loopLengthBeats;
        const passEnd = passOrigin + (passIndex + 1) * loopLengthBeats;
        const wrapBeat = passEnd - phase;
        const isHead = phase === 0 || cursor < wrapBeat;
        const partStart = isHead ? passStart : wrapBeat;
        const partEnd = isHead ? wrapBeat : passEnd;
        const endBeat = Math.min(iterationEndBeat, partEnd);
        if (!(endBeat > cursor)) {
            return [];
        }
        const isFirstVisiblePart = partStart <= clip.startBeat && clip.startBeat < partEnd;
        let sourceAnchor: number;
        if (isFirstVisiblePart) {
            sourceAnchor = source.audioOffsetSeconds;
        } else if (isHead) {
            sourceAnchor = headSource;
        } else {
            sourceAnchor = resetSource;
        }
        const beatAnchor = isFirstVisiblePart ? clip.startBeat : partStart;
        segments.push({
            startOffsetBeats: cursor - iterationStartBeat,
            endOffsetBeats: endBeat - iterationStartBeat,
            sourceStartSeconds: getAudioSourcePositionSeconds(
                sourceAnchor,
                secondsAtBeat(cursor) - secondsAtBeat(beatAnchor),
                stretchRatio
            ),
        });
        cursor = endBeat;
        if (cursor === passEnd) {
            passIndex += 1;
        }
    }
    return segments;
}
