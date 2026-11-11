import { type SourceWithFade } from '../../models/SourceWithFade';

import { cutSource } from './cutSource';

type MediaTrack = {
    id: string;
    kind: string;
    freezeState: { status: string; frozenBufferId?: string };
};

function currentFrozenKeyOf(track: MediaTrack): string | null {
    return track.freezeState.status === 'frozen' && track.freezeState.frozenBufferId
        ? `${track.id}:${track.freezeState.frozenBufferId}`
        : null;
}

function ownsCurrentMedia(source: SourceWithFade, currentFrozenKey: string | null): boolean {
    return currentFrozenKey ? source.scheduledFrozenKey === currentFrozenKey : source.scheduledAudioKey !== undefined;
}

function findReplacementStart(
    track: MediaTrack,
    currentFrozenKey: string | null,
    activeAudioSources: readonly AudioBufferSourceNode[]
): number {
    let replacementStart = Infinity;
    for (const candidate of activeAudioSources as SourceWithFade[]) {
        if (
            candidate.scheduledTrackId === track.id &&
            ownsCurrentMedia(candidate, currentFrozenKey) &&
            candidate.scheduledStopTime === undefined &&
            candidate.scheduledStartTime !== undefined
        ) {
            replacementStart = Math.min(replacementStart, candidate.scheduledStartTime);
        }
    }
    return replacementStart;
}

function isSuperseded(source: SourceWithFade, currentFrozenKey: string | null): boolean {
    if (!currentFrozenKey) {
        return source.scheduledFrozenKey !== undefined;
    }
    return (
        source.scheduledAudioKey !== undefined ||
        (source.scheduledFrozenKey !== undefined && source.scheduledFrozenKey !== currentFrozenKey)
    );
}

function releaseDedupOwnership(
    source: SourceWithFade,
    scheduledAudioClipsSet: Set<string>,
    scheduledFrozenTracks: Set<string>,
    activeAudioSources: readonly AudioBufferSourceNode[]
): void {
    const sources = activeAudioSources as SourceWithFade[];
    if (
        source.scheduledAudioKey &&
        !sources.some((candidate) => candidate !== source && candidate.scheduledAudioKey === source.scheduledAudioKey)
    ) {
        scheduledAudioClipsSet.delete(source.scheduledAudioKey);
    }
    if (
        source.scheduledFrozenKey &&
        !sources.some((candidate) => candidate !== source && candidate.scheduledFrozenKey === source.scheduledFrozenKey)
    ) {
        scheduledFrozenTracks.delete(source.scheduledFrozenKey);
    }
}

function retireSource(
    source: SourceWithFade,
    index: number,
    ctx: BaseAudioContext,
    stopAt: number,
    scheduledAudioClipsSet: Set<string>,
    scheduledFrozenTracks: Set<string>,
    activeAudioSources: AudioBufferSourceNode[]
): void {
    const now = ctx.currentTime;
    if (source.scheduledStopTime !== undefined && source.scheduledStopTime <= now) {
        activeAudioSources.splice(index, 1);
    } else {
        const futureStart = source.scheduledStartTime !== undefined && source.scheduledStartTime >= now;
        const actualStop = futureStart ? now : Math.max(now, stopAt);
        if (source.scheduledStopTime !== actualStop) {
            if (futureStart) {
                source.stop(actualStop);
            } else {
                cutSource(source, ctx, actualStop);
            }
            source.scheduledStopTime = actualStop;
        }
        if (actualStop <= now) {
            activeAudioSources.splice(index, 1);
        }
    }
    // A future-stopped source remains available for a reversed handoff, but its
    // key must not block the replacement. Never drop a key that replacement owns.
    releaseDedupOwnership(source, scheduledAudioClipsSet, scheduledFrozenTracks, activeAudioSources);
}

/** Retire sources whose track has changed media owner, without disturbing other tracks or the new owner. */
export function retireSupersededMidiMedia(
    tracks: readonly MediaTrack[],
    ctx: BaseAudioContext,
    scheduledAudioClipsSet: Set<string>,
    scheduledFrozenTracks: Set<string>,
    activeAudioSources: AudioBufferSourceNode[],
    phase: 'detect' | 'retire' = 'retire'
): boolean {
    let retired = false;
    for (const track of tracks) {
        if (track.kind !== 'audio' && track.kind !== 'midi') {
            continue;
        }
        const currentFrozenKey = currentFrozenKeyOf(track);
        const replacementStart = findReplacementStart(track, currentFrozenKey, activeAudioSources);
        const stopAt = Math.max(
            ctx.currentTime,
            Number.isFinite(replacementStart) ? replacementStart : ctx.currentTime
        );
        for (let index = activeAudioSources.length - 1; index >= 0; index--) {
            const source: SourceWithFade = activeAudioSources[index]!;
            if (source.scheduledTrackId !== track.id) {
                continue;
            }
            const superseded = isSuperseded(source, currentFrozenKey);
            const replacedPendingOwner =
                !superseded &&
                ownsCurrentMedia(source, currentFrozenKey) &&
                source.scheduledStopTime !== undefined &&
                Number.isFinite(replacementStart);
            if (!superseded && !replacedPendingOwner) {
                continue;
            }
            retired = true;
            if (phase === 'detect') {
                continue;
            }
            retireSource(source, index, ctx, stopAt, scheduledAudioClipsSet, scheduledFrozenTracks, activeAudioSources);
        }
    }
    return retired;
}
