import { clipSelectionStore, trackStore } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';

import { elasticAudioStore, defaultElasticAudioState } from '../../stores/elasticAudio';

import { cancelTransientDetection } from './cancelTransientDetection';
import { resolveElasticEditorTarget } from './resolveElasticEditorTarget';
import { transientDetectionRevision } from './transientDetectionRevision';

function currentTarget() {
    return resolveElasticEditorTarget(
        elasticAudioStore.value ?? defaultElasticAudioState,
        clipSelectionStore.value,
        trackStore.value
    );
}

function hasValidSource(buffer: AudioBuffer | undefined): boolean {
    return (
        buffer !== undefined &&
        Number.isFinite(buffer.sampleRate) &&
        buffer.sampleRate > 0 &&
        Number.isInteger(buffer.length) &&
        buffer.length > 0 &&
        Number.isInteger(buffer.numberOfChannels) &&
        buffer.numberOfChannels > 0
    );
}

function hasSameGeometry(
    buffer: AudioBuffer | undefined,
    sampleRate: number | undefined,
    frames: number | undefined,
    channels: number | undefined
): boolean {
    return buffer?.sampleRate === sampleRate && buffer?.length === frames && buffer?.numberOfChannels === channels;
}

function subscribeToOwnerChanges(invalidate: () => void): () => void {
    const subscriptions = [
        elasticAudioStore.subscribe(invalidate),
        clipSelectionStore.subscribe(invalidate),
        trackStore.subscribe(invalidate),
    ];
    let disposed = false;
    return () => {
        if (disposed) {
            return;
        }
        disposed = true;
        for (const unsubscribe of subscriptions) {
            unsubscribe();
        }
    };
}

export function captureElasticDetectionOwner(
    rootIdentitySource: { captureRootIdentity: (() => string) | null },
    signal?: AbortSignal,
    expectedClipId?: string
) {
    const target = currentTarget();
    if (expectedClipId !== undefined && target.clipId !== expectedClipId) {
        return undefined;
    }
    const openedClipId = elasticAudioStore.value?.openClipId ?? null;
    const clipType = target.clip?.type;
    const bufferId = target.clip?.audioBufferId;
    const buffer = clipType === 'audio' && bufferId ? audioBufferCache.get(bufferId) : undefined;
    const sampleRate = buffer?.sampleRate;
    const frames = buffer?.length;
    const channels = buffer?.numberOfChannels;
    const validSource = hasValidSource(buffer);
    const captureRootIdentity = rootIdentitySource.captureRootIdentity;
    if (!captureRootIdentity) {
        throw new Error('Elastic detection root identity capture is not configured');
    }
    const rootIdentity = captureRootIdentity();
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
        abort();
    }
    if (validSource && target.clipId) {
        cancelTransientDetection(target.clipId);
    }
    const revision = target.clipId ? transientDetectionRevision(target.clipId) : 0;
    let invalidated = false;
    const matches = (): boolean => {
        const current = currentTarget();
        const liveBuffer = bufferId ? audioBufferCache.get(bufferId) : undefined;
        return (
            rootIdentitySource.captureRootIdentity === captureRootIdentity &&
            captureRootIdentity() === rootIdentity &&
            (elasticAudioStore.value?.openClipId ?? null) === openedClipId &&
            current.clipId === target.clipId &&
            current.trackId === target.trackId &&
            current.clip?.type === clipType &&
            current.clip?.audioBufferId === bufferId &&
            liveBuffer === buffer &&
            hasSameGeometry(liveBuffer, sampleRate, frames, channels)
        );
    };
    const invalidate = (): void => {
        if (!matches()) {
            invalidated = true;
            abort();
        }
    };
    const unsubscribe = subscribeToOwnerChanges(invalidate);
    const dispose = (): void => {
        unsubscribe();
        signal?.removeEventListener('abort', abort);
    };
    return {
        clipId: target.clipId,
        validSource,
        signal: controller.signal,
        revision,
        matches,
        isInvalidated: () => invalidated,
        dispose,
        abort,
    };
}
