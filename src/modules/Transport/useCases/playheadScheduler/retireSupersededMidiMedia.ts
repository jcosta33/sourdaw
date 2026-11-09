import { type SourceWithFade } from '../../models/SourceWithFade';

import { cutSource } from './cutSource';

type MediaTrack = {
    id: string;
    kind: string;
    freezeState: { status: string; frozenBufferId?: string };
};

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
        const currentFrozenKey =
            track.freezeState.status === 'frozen' && track.freezeState.frozenBufferId
                ? `${track.id}:${track.freezeState.frozenBufferId}`
                : null;
        let replacementStart = Infinity;
        for (const candidate of activeAudioSources as SourceWithFade[]) {
            let currentOwner = candidate.scheduledAudioKey !== undefined;
            if (currentFrozenKey) {
                currentOwner = candidate.scheduledFrozenKey === currentFrozenKey;
            }
            if (candidate.scheduledTrackId === track.id && currentOwner && candidate.scheduledStartTime !== undefined) {
                replacementStart = Math.min(replacementStart, candidate.scheduledStartTime);
            }
        }
        const stopAt = Math.max(
            ctx.currentTime,
            Number.isFinite(replacementStart) ? replacementStart : ctx.currentTime
        );
        for (let index = activeAudioSources.length - 1; index >= 0; index--) {
            const source: SourceWithFade = activeAudioSources[index]!;
            if (source.scheduledTrackId !== track.id) {
                continue;
            }
            let superseded = source.scheduledFrozenKey !== undefined;
            if (currentFrozenKey) {
                superseded =
                    source.scheduledAudioKey !== undefined ||
                    (source.scheduledFrozenKey !== undefined && source.scheduledFrozenKey !== currentFrozenKey);
            }
            if (!superseded) {
                continue;
            }
            if (phase === 'detect') {
                retired = true;
                continue;
            }
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
            retired = true;
        }
    }
    return retired;
}
