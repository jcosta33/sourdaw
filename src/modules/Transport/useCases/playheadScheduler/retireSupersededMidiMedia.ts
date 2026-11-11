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

function findReplacementStart(
    track: MediaTrack,
    currentFrozenKey: string | null,
    activeAudioSources: readonly AudioBufferSourceNode[]
): number {
    let replacementStart = Infinity;
    for (const candidate of activeAudioSources as SourceWithFade[]) {
        const currentOwner = currentFrozenKey
            ? candidate.scheduledFrozenKey === currentFrozenKey
            : candidate.scheduledAudioKey !== undefined;
        if (candidate.scheduledTrackId === track.id && currentOwner && candidate.scheduledStartTime !== undefined) {
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
    const futureStart = source.scheduledStartTime !== undefined && source.scheduledStartTime >= now;
    const actualStop = futureStart ? now : Math.max(now, stopAt);
    if (futureStart) {
        source.stop(actualStop);
    } else {
        cutSource(source, ctx, actualStop);
    }
    source.scheduledStopTime = actualStop;
    activeAudioSources.splice(index, 1);
    if (source.scheduledAudioKey) {
        scheduledAudioClipsSet.delete(source.scheduledAudioKey);
    }
    if (source.scheduledFrozenKey) {
        scheduledFrozenTracks.delete(source.scheduledFrozenKey);
    }
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
            if (source.scheduledTrackId !== track.id || !isSuperseded(source, currentFrozenKey)) {
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
