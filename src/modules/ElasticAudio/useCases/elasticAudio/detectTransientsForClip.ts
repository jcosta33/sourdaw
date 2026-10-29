import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';
import { getSettledProjectId } from '#/modules/Project/stores';
import { transportStore } from '#/modules/Transport/stores';

import { elasticAudioStore } from '../../stores/elasticAudio';

import { readProductTransientOnsets } from './readClipTransientOnsets';

const active = new Map<string, AbortController>();
const revisions = new Map<string, number>();

export function transientDetectionRevision(clipId: string): number {
    return revisions.get(clipId) ?? 0;
}

/** Revoke immediately, including during the sensitivity debounce and editor teardown. */
export function cancelTransientDetection(clipId: string): void {
    active.get(clipId)?.abort();
    active.delete(clipId);
    revisions.set(clipId, transientDetectionRevision(clipId) + 1);
}

/** Read-only owned-copy Worker stage; Arrangement's registered action owns the write. */
export async function detectTransientsForClip(clipId: string, sensitivity: number, signal?: AbortSignal) {
    cancelTransientDetection(clipId);
    const controller = new AbortController();
    active.set(clipId, controller);
    const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
        abort();
    }
    const projectId = getSettledProjectId();
    const root = captureProjectRootIdentity();
    const tempo = transportStore.value?.tempo;
    const editorClip = elasticAudioStore.value?.openClipId;
    const preference = preferencesStore.value?.elasticTransientSensitivity;
    const unsubscribePreference = preferencesStore.subscribe((state) => {
        if (state?.elasticTransientSensitivity !== preference) abort();
    });
    let editorChanged = false;
    const unsubscribe = elasticAudioStore.subscribe((state) => {
        if (state?.openClipId !== editorClip) {
            editorChanged = true;
            abort();
        }
    });
    const isCurrent = (): boolean =>
        !controller.signal.aborted &&
        active.get(clipId) === controller &&
        !editorChanged &&
        elasticAudioStore.value?.openClipId === editorClip &&
        preferencesStore.value?.elasticTransientSensitivity === preference &&
        captureProjectRootIdentity() === root &&
        getSettledProjectId() === projectId &&
        transportStore.value?.tempo === tempo;
    const dispose = (): void => {
        signal?.removeEventListener('abort', abort);
        unsubscribe();
        unsubscribePreference();
    };
    if (!projectId || !tempo || !Number.isFinite(tempo) || tempo <= 0) {
        dispose();
        return { status: 'failed' as const, code: 'stale-source' as const };
    }
    try {
        const result = await readProductTransientOnsets({
            clipId,
            sensitivity,
            projectId,
            isProjectRevisionCurrent: isCurrent,
            maxSourceSeconds: 600,
            maxChannelSamples: 12_000_000,
            timeoutMs: 30_000,
            signal: controller.signal,
            onAnalysisStarted: () => undefined,
        });
        if (result.status === 'failed') {
            return result;
        }
        return {
            ...result,
            tempo,
            isCurrent: () => isCurrent() && result.isCurrent(),
        };
    } finally {
        dispose();
        // Retain the identity through final commit validation. The next request or
        // explicit cancellation revokes it even after the Worker has settled.
    }
}
