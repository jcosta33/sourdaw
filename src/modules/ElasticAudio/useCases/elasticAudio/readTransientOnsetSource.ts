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

type ReadInput = {
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
};
type SourceGeometry = Pick<SourceIdentity, 'sampleRate' | 'frameCount' | 'channelCount'>;
type CachedSource = { rawBufferId: string; buffer: AudioBuffer; identity: SourceIdentity };
type PreparedSource = Extract<SourceRead, { status: 'failed' }> | { status: 'ready'; source: CachedSource };

function revisionIsCurrent(input: ReadInput): boolean {
    return getSettledProjectId() === input.projectId && input.isProjectRevisionCurrent();
}

function validGeometry({ sampleRate, frameCount, channelCount }: SourceGeometry): boolean {
    return (
        Number.isFinite(sampleRate) &&
        sampleRate > 0 &&
        Number.isSafeInteger(frameCount) &&
        frameCount > 0 &&
        Number.isSafeInteger(channelCount) &&
        channelCount >= 1
    );
}

function validReadLimits(input: ReadInput, found: ReturnType<typeof findSource>[number]): boolean {
    return (
        Number.isFinite(input.maxSourceSeconds) &&
        input.maxSourceSeconds > 0 &&
        Number.isSafeInteger(input.maxChannelSamples) &&
        input.maxChannelSamples >= 1 &&
        Number.isFinite(input.timeoutMs) &&
        input.timeoutMs > 0 &&
        Number.isFinite(input.sensitivity) &&
        input.sensitivity >= 0 &&
        input.sensitivity <= 1 &&
        ![input.projectId, input.clipId, found.trackId, found.alternativeId ?? ''].some((id) => id.length > 256)
    );
}

function prepareSource(input: ReadInput, channelSampleCeiling: number): PreparedSource {
    if (input.signal?.aborted) {
        return { status: 'failed', code: 'cancelled' };
    }
    if (!revisionIsCurrent(input)) {
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
    const geometry = {
        sampleRate: buffer.sampleRate,
        frameCount: buffer.length,
        channelCount: buffer.numberOfChannels,
    };
    if (!validGeometry(geometry) || !validReadLimits(input, found)) {
        return { status: 'failed', code: 'invalid-source' };
    }
    if (
        geometry.frameCount / geometry.sampleRate > Math.min(input.maxSourceSeconds, 600) ||
        geometry.frameCount * geometry.channelCount > Math.min(input.maxChannelSamples, channelSampleCeiling)
    ) {
        return { status: 'failed', code: 'source-too-large' };
    }
    return {
        status: 'ready',
        source: {
            rawBufferId,
            buffer,
            identity: {
                projectId: input.projectId,
                clipId: input.clipId,
                trackId: found.trackId,
                alternativeId: found.alternativeId,
                activeAlternative: found.activeAlternative,
                bufferId: digest(rawBufferId),
                ...geometry,
            },
        },
    };
}

function sourceIsCurrent(input: ReadInput, { identity, rawBufferId, buffer }: CachedSource): boolean {
    if (input.signal?.aborted || !revisionIsCurrent(input)) {
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
        buffer.sampleRate === identity.sampleRate &&
        buffer.length === identity.frameCount &&
        buffer.numberOfChannels === identity.channelCount
    );
}

function copySourceChannels({ buffer, identity }: CachedSource): Float32Array[] | null {
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < identity.channelCount; channel++) {
        const samples = buffer.getChannelData(channel);
        if (samples.length !== identity.frameCount) {
            return null;
        }
        channels.push(new Float32Array(samples));
    }
    return channels;
}

/** Bound each product copy task; cached channel buffers always stay owned by the cache. */
async function copyProductChannels(source: CachedSource, isCurrent: () => boolean): Promise<Float32Array[] | null> {
    const channels: Float32Array[] = [];
    const chunkFrames = 262_144;
    for (let channel = 0; channel < source.identity.channelCount; channel++) {
        const samples = source.buffer.getChannelData(channel);
        if (samples.length !== source.identity.frameCount) {
            return null;
        }
        const copy = new Float32Array(samples.length);
        for (let start = 0; start < samples.length; start += chunkFrames) {
            if (!isCurrent()) {
                return null;
            }
            const taskStarted = performance.now();
            copy.set(samples.subarray(start, start + chunkFrames), start);
            performance.measure('elastic-transient-copy-task', { start: taskStarted, end: performance.now() });
            performance.clearMeasures('elastic-transient-copy-task');
            if (start + chunkFrames < samples.length) {
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
        }
        channels.push(copy);
    }
    return channels;
}

export async function readTransientOnsetSource(input: ReadInput, channelSampleCeiling: number): Promise<SourceRead> {
    const prepared = prepareSource(input, channelSampleCeiling);
    if (prepared.status === 'failed') {
        return prepared;
    }
    const { source } = prepared;
    const isCurrent = (): boolean => sourceIsCurrent(input, source);
    try {
        if (!isCurrent()) {
            return { status: 'failed', code: 'stale-source' };
        }
        let channels: ReturnType<typeof copySourceChannels>;
        if (channelSampleCeiling === 10_000_000) {
            channels = copySourceChannels(source);
        } else {
            channels = await copyProductChannels(source, isCurrent);
        }
        if (channels === null) {
            let code: 'cancelled' | 'stale-source' | 'invalid-source' = 'invalid-source';
            if (input.signal?.aborted) {
                code = 'cancelled';
            } else if (!isCurrent()) {
                code = 'stale-source';
            }
            return { status: 'failed', code };
        }
        if (!isCurrent()) {
            return { status: 'failed', code: 'stale-source' };
        }
        input.onAnalysisStarted();
        const result = await runTransientOnsetWorker({
            channels,
            sampleRate: source.identity.sampleRate,
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
        return { status: 'complete', identity: source.identity, hits: result.hits, isCurrent };
    } catch {
        return { status: 'failed', code: 'analysis-failed' };
    }
}
