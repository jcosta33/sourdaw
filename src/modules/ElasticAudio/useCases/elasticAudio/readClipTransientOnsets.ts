import { trackStore } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getSettledProjectId } from '#/modules/Project/stores';
import { digest } from '#/utils/canonicalDigest';

import { runTransientOnsetWorker } from '../../repositories/transientOnsetWorkerClient';

type SourceIdentity = {
    projectId: string;
    clipId: string;
    trackId: string;
    alternativeId: string | null;
    activeAlternative: boolean;
    bufferId: string;
    sampleRate: number;
    frameCount: number;
    channelCount: number;
};

type FailureCode =
    | 'stale-source'
    | 'clip-not-found'
    | 'duplicate-clip-id'
    | 'clip-not-audio'
    | 'missing-buffer'
    | 'invalid-source'
    | 'source-too-large'
    | 'cancelled'
    | 'analysis-timed-out'
    | 'analysis-failed';

type SourceRead =
    | { status: 'failed'; code: FailureCode }
    | {
          status: 'complete';
          identity: SourceIdentity;
          hits: readonly { sampleOffset: number; confidence: number }[];
          isCurrent: () => boolean;
      };

function findSource(clipId: string) {
    const found = [];
    for (const track of trackStore.value?.tracks ?? []) {
        const activeAlternativeId =
            track.alternatives?.find((alternative) => alternative.id === track.activeAlternativeId)?.id ?? null;
        for (const clip of track.clips) {
            if (clip.id === clipId) {
                found.push({ clip, trackId: track.id, alternativeId: activeAlternativeId, activeAlternative: true });
            }
        }
        for (const alternative of track.alternatives ?? []) {
            // The active alternative keeps a snapshot; track.clips owns its current projection.
            if (alternative.id === track.activeAlternativeId) {
                continue;
            }
            for (const clip of alternative.clips) {
                if (clip.id === clipId) {
                    found.push({
                        clip,
                        trackId: track.id,
                        alternativeId: alternative.id,
                        activeAlternative: alternative.id === track.activeAlternativeId,
                    });
                }
            }
        }
    }
    return found;
}

/** A whole-source local read. The caller admits work before entering this cache boundary. */
export async function readClipTransientOnsets(input: {
    clipId: string;
    sensitivity: number;
    projectId: string;
    /** The planning caller owns the captured CRDT revision; this owner rechecks it around analysis. */
    isProjectRevisionCurrent: () => boolean;
    maxSourceSeconds: number;
    maxChannelSamples: number;
    timeoutMs: number;
    signal?: AbortSignal;
    onAnalysisStarted: () => void;
}): Promise<SourceRead> {
    const revisionCurrent = (): boolean =>
        getSettledProjectId() === input.projectId && input.isProjectRevisionCurrent();
    if (input.signal?.aborted) {
        return { status: 'failed', code: 'cancelled' };
    }
    if (!revisionCurrent()) {
        return { status: 'failed', code: 'stale-source' };
    }
    const candidates = findSource(input.clipId);
    if (candidates.length !== 1) {
        return { status: 'failed', code: candidates.length === 0 ? 'clip-not-found' : 'duplicate-clip-id' };
    }
    const found = candidates[0]!;
    if (found.clip.type !== 'audio') {
        return { status: 'failed', code: 'clip-not-audio' };
    }
    const rawBufferId = found.clip.audioBufferId;
    const buffer = rawBufferId ? audioBufferCache.get(rawBufferId) : undefined;
    if (!buffer || !rawBufferId) {
        return { status: 'failed', code: 'missing-buffer' };
    }
    const { sampleRate, length: frameCount, numberOfChannels: channelCount } = buffer;
    if (
        !Number.isFinite(sampleRate) ||
        sampleRate <= 0 ||
        !Number.isSafeInteger(frameCount) ||
        frameCount <= 0 ||
        !Number.isSafeInteger(channelCount) ||
        channelCount < 1 ||
        !Number.isFinite(input.maxSourceSeconds) ||
        input.maxSourceSeconds <= 0 ||
        !Number.isSafeInteger(input.maxChannelSamples) ||
        input.maxChannelSamples < 1 ||
        !Number.isFinite(input.timeoutMs) ||
        input.timeoutMs <= 0 ||
        !Number.isFinite(input.sensitivity) ||
        input.sensitivity < 0 ||
        input.sensitivity > 1 ||
        [input.projectId, input.clipId, found.trackId, found.alternativeId ?? ''].some((id) => id.length > 256)
    ) {
        return { status: 'failed', code: 'invalid-source' };
    }
    if (
        frameCount / sampleRate > Math.min(input.maxSourceSeconds, 600) ||
        frameCount * channelCount > Math.min(input.maxChannelSamples, 10_000_000)
    ) {
        return { status: 'failed', code: 'source-too-large' };
    }
    const identity: SourceIdentity = {
        projectId: input.projectId,
        clipId: input.clipId,
        trackId: found.trackId,
        alternativeId: found.alternativeId,
        activeAlternative: found.activeAlternative,
        bufferId: digest(rawBufferId),
        sampleRate,
        frameCount,
        channelCount,
    };
    const isCurrent = (): boolean => {
        if (input.signal?.aborted || !revisionCurrent()) {
            return false;
        }
        const matches = findSource(input.clipId);
        const live = matches[0];
        return (
            matches.length === 1 &&
            live !== undefined &&
            live.clip.type === 'audio' &&
            live.clip.audioBufferId === rawBufferId &&
            live.trackId === identity.trackId &&
            live.alternativeId === identity.alternativeId &&
            live.activeAlternative === identity.activeAlternative &&
            audioBufferCache.get(rawBufferId) === buffer &&
            buffer.sampleRate === sampleRate &&
            buffer.length === frameCount &&
            buffer.numberOfChannels === channelCount
        );
    };
    try {
        if (!isCurrent()) {
            return { status: 'failed', code: 'stale-source' };
        }
        const channels: Float32Array[] = [];
        for (let channel = 0; channel < channelCount; channel++) {
            const samples = buffer.getChannelData(channel);
            if (samples.length !== frameCount) {
                return { status: 'failed', code: 'invalid-source' };
            }
            channels.push(new Float32Array(samples));
        }
        input.onAnalysisStarted();
        const result = await runTransientOnsetWorker({
            channels,
            sampleRate,
            sensitivity: input.sensitivity,
            timeoutMs: input.timeoutMs,
            signal: input.signal,
        });
        if (result.status === 'failed') {
            return result;
        }
        if (!isCurrent()) {
            return { status: 'failed', code: input.signal?.aborted ? 'cancelled' : 'stale-source' };
        }
        return { status: 'complete', identity, hits: result.hits, isCurrent };
    } catch {
        return { status: 'failed', code: 'analysis-failed' };
    }
}
