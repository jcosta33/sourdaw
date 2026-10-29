import { preferencesStore } from '#/modules/Preferences/stores';
import { getSettledProjectId } from '#/modules/Project/stores';
import { transportStore } from '#/modules/Transport/stores';

import { elasticAudioStore } from '../../stores/elasticAudio';

import { readProductTransientOnsets } from './readClipTransientOnsets';
import { elasticRootIdentityProviderState } from './elasticRootIdentityProviderState';

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

/** Align visible commits; a hidden page can finish without its suspended animation frame. */
function waitForCommitFrame(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) {
        return Promise.resolve(false);
    }
    if (document.hidden) {
        return Promise.resolve(true);
    }
    return new Promise((resolve) => {
        let frame: number | undefined;
        let settled = false;
        const finish = (admitted: boolean): void => {
            if (settled) {
                return;
            }
            settled = true;
            if (frame !== undefined) {
                cancelAnimationFrame(frame);
            }
            signal.removeEventListener('abort', abort);
            document.removeEventListener('visibilitychange', visibilityChanged);
            window.removeEventListener('pagehide', abort);
            resolve(admitted);
        };
        const abort = (): void => finish(false);
        const visibilityChanged = (): void => {
            if (document.hidden) {
                finish(true);
            }
        };
        signal.addEventListener('abort', abort, { once: true });
        document.addEventListener('visibilitychange', visibilityChanged);
        window.addEventListener('pagehide', abort, { once: true });
        frame = requestAnimationFrame(() => finish(true));
    });
}

type ProductRead = Awaited<ReturnType<typeof readProductTransientOnsets>>;
type DetectionReady = Extract<ProductRead, { status: 'complete' }> & { tempo: number };
type DetectionLifetime = {
    readonly signal: AbortSignal;
    isCurrent(): boolean;
    waitForFrame(): Promise<boolean>;
};

export function detectTransientsForClip(
    clipId: string,
    sensitivity: number,
    signal?: AbortSignal
): Promise<Extract<ProductRead, { status: 'failed' }> | DetectionReady>;
export function detectTransientsForClip<Result>(
    clipId: string,
    sensitivity: number,
    signal: AbortSignal | undefined,
    consume: (ready: DetectionReady, lifetime: DetectionLifetime) => Promise<Result>
): Promise<Extract<ProductRead, { status: 'failed' }> | { status: 'consumed'; value: Result }>;
/** Keep source and abort ownership alive throughout an async product consumer; Arrangement owns its final write. */
export async function detectTransientsForClip<Result>(
    clipId: string,
    sensitivity: number,
    signal?: AbortSignal,
    consume?: (ready: DetectionReady, lifetime: DetectionLifetime) => Promise<Result>
) {
    cancelTransientDetection(clipId);
    const captureRootIdentity = elasticRootIdentityProviderState.captureRootIdentity;
    if (!captureRootIdentity) {
        return { status: 'failed' as const, code: 'stale-source' as const };
    }
    const controller = new AbortController();
    active.set(clipId, controller);
    const abort = (): void => controller.abort();
    const deadline = performance.now() + 30_000;
    let timedOut = false;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const expired = (): boolean => timedOut || performance.now() >= deadline;
    window.addEventListener('pagehide', abort, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
        abort();
    }
    const projectId = getSettledProjectId();
    const root = captureRootIdentity();
    const tempo = transportStore.value?.tempo;
    const editorClip = elasticAudioStore.value?.openClipId;
    const preference = preferencesStore.value?.elasticTransientSensitivity;
    const unsubscribePreference = preferencesStore.subscribe((state) => {
        if (state?.elasticTransientSensitivity !== preference) {
            abort();
        }
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
        !expired() &&
        active.get(clipId) === controller &&
        !editorChanged &&
        elasticAudioStore.value?.openClipId === editorClip &&
        preferencesStore.value?.elasticTransientSensitivity === preference &&
        elasticRootIdentityProviderState.captureRootIdentity === captureRootIdentity &&
        captureRootIdentity() === root &&
        getSettledProjectId() === projectId &&
        transportStore.value?.tempo === tempo;
    const dispose = (): void => {
        if (deadlineTimer !== undefined) {
            clearTimeout(deadlineTimer);
        }
        window.removeEventListener('pagehide', abort);
        signal?.removeEventListener('abort', abort);
        unsubscribe();
        unsubscribePreference();
    };
    if (!projectId || !tempo || !Number.isFinite(tempo) || tempo <= 0) {
        dispose();
        return { status: 'failed' as const, code: 'stale-source' as const };
    }
    deadlineTimer = setTimeout(
        () => {
            timedOut = true;
            abort();
        },
        Math.max(0, deadline - performance.now())
    );
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
        if (expired()) {
            return { status: 'failed' as const, code: 'analysis-timed-out' as const };
        }
        if (result.status === 'failed') {
            return result;
        }
        const ready: DetectionReady = {
            ...result,
            tempo,
            isCurrent: () => isCurrent() && result.isCurrent(),
        };
        if (consume) {
            const value = await consume(ready, {
                signal: controller.signal,
                isCurrent: ready.isCurrent,
                waitForFrame: async () =>
                    ready.isCurrent() && (await waitForCommitFrame(controller.signal)) && ready.isCurrent(),
            });
            if (expired()) {
                return { status: 'failed' as const, code: 'analysis-timed-out' as const };
            }
            return { status: 'consumed' as const, value };
        }
        if (!(await waitForCommitFrame(controller.signal))) {
            abort();
            return { status: 'failed' as const, code: 'cancelled' as const };
        }
        if (expired()) {
            return { status: 'failed' as const, code: 'analysis-timed-out' as const };
        }
        return ready;
    } finally {
        dispose();
        // Retain the identity through final commit validation. The next request or
        // explicit cancellation revokes it even after the Worker has settled.
    }
}
