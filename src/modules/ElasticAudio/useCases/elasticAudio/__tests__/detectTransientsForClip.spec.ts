import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';

import { elasticAudioStore, defaultElasticAudioState } from '../../../stores/elasticAudio';
import { cancelTransientDetection } from '../cancelTransientDetection';
import { detectTransientsForClip } from '../detectTransientsForClip';
import { setElasticRootIdentityProvider } from '../setElasticRootIdentityProvider';
import { transientDetectionLifecycle } from '../transientDetectionLifecycle';

const mocks = vi.hoisted(() => ({ read: vi.fn(), root: 'root-1', tempo: 120 }));
vi.mock('../readProductTransientOnsets', () => ({ readProductTransientOnsets: mocks.read }));
vi.mock('#/modules/Project/stores', () => ({ getSettledProjectId: () => 'project-1' }));
vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return { tempo: mocks.tempo };
        },
    },
}));

describe('product transient Worker source lifetime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        preferencesStore.trySet(defaultPreferences);
        mocks.root = 'root-1';
        setElasticRootIdentityProvider(() => mocks.root);
        mocks.tempo = 120;
        elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-1' });
        mocks.read.mockResolvedValue({
            status: 'complete',
            hits: [],
            identity: { clipId: 'clip-1' },
            isCurrent: () => true,
        });
    });
    afterEach(() => {
        cancelTransientDetection('clip-1');
        setElasticRootIdentityProvider(null);
        vi.restoreAllMocks();
        vi.useRealTimers();
    });
    it('returns Worker analysis without writing Arrangement and captures tempo', async () => {
        const result = await detectTransientsForClip('clip-1', 0.82);
        expect(mocks.read).toHaveBeenCalledWith(
            expect.objectContaining({ sensitivity: 0.82, maxChannelSamples: 12_000_000 })
        );
        expect(result.status).toBe('complete');
        if (result.status !== 'complete') {
            throw new Error('Expected completed analysis');
        }
        expect(result.tempo).toBe(120);
        expect(result.isCurrent()).toBe(true);
        mocks.tempo = 128;
        expect(result.isCurrent()).toBe(false);
    });
    it.each(['root', 'editor', 'cancel', 'successor', 'preference'] as const)(
        'revokes an earlier completed read on %s',
        async (change) => {
            const result = await detectTransientsForClip('clip-1', 0.5);
            if (result.status !== 'complete') {
                throw new Error('Expected completed analysis');
            }
            if (change === 'root') {
                mocks.root = 'root-2';
            }
            if (change === 'preference') {
                preferencesStore.trySet({ ...defaultPreferences, elasticTransientSensitivity: 0.82 });
            }
            if (change === 'editor') {
                elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-2' });
            }
            if (change === 'cancel') {
                cancelTransientDetection('clip-1');
            }
            if (change === 'successor') {
                await detectTransientsForClip('clip-1', 0.82);
            }
            expect(result.isCurrent()).toBe(false);
        }
    );
    it('fails closed without a provider before starting the Worker and allows configured retry', async () => {
        const previous = await detectTransientsForClip('clip-1', 0.5);
        if (previous.status !== 'complete') {
            throw new Error('Expected completed analysis');
        }
        mocks.read.mockClear();
        setElasticRootIdentityProvider(null);
        expect(await detectTransientsForClip('clip-1', 0.5)).toEqual({ status: 'failed', code: 'stale-source' });
        expect(mocks.read).not.toHaveBeenCalled();
        expect(previous.isCurrent()).toBe(false);
        setElasticRootIdentityProvider(() => mocks.root);
        expect((await detectTransientsForClip('clip-1', 0.5)).status).toBe('complete');
    });
    it.each(['removed', 'replaced'] as const)('revokes a completed read when the provider is %s', async (change) => {
        const result = await detectTransientsForClip('clip-1', 0.5);
        if (result.status !== 'complete') {
            throw new Error('Expected completed analysis');
        }
        if (change === 'removed') {
            setElasticRootIdentityProvider(null);
        } else {
            setElasticRootIdentityProvider(() => mocks.root);
        }
        expect(result.isCurrent()).toBe(false);
    });
    it('binds unchanged completion to the current controller and exact invocation revision', async () => {
        const first = await detectTransientsForClip('clip-1', 0.5);
        if (first.status !== 'complete') {
            throw new Error('Expected completed first analysis');
        }
        const revision = transientDetectionLifecycle.revision('clip-1');
        expect(first.completeUnchanged()).toBe(true);
        expect(transientDetectionLifecycle.readCompletion('clip-1', revision)).toEqual({
            status: 'unchanged',
            revision,
        });
        expect(transientDetectionLifecycle.readCompletion('clip-1', revision + 1)).toBeUndefined();
        const successor = await detectTransientsForClip('clip-1', 0.5);
        if (successor.status !== 'complete') {
            throw new Error('Expected completed successor analysis');
        }
        expect(first.completeUnchanged()).toBe(false);
        expect(transientDetectionLifecycle.readCompletion('clip-1', revision)).toBeUndefined();
        expect(transientDetectionLifecycle.readCompletion('clip-1', revision + 1)).toBeUndefined();
        expect(successor.completeUnchanged()).toBe(true);
        cancelTransientDetection('clip-1');
        expect(successor.completeUnchanged()).toBe(false);
        expect(transientDetectionLifecycle.readCompletion('clip-1', revision + 1)).toBeUndefined();
    });

    it('propagates Worker failure and allows retry', async () => {
        mocks.read.mockResolvedValueOnce({ status: 'failed', code: 'analysis-failed' });
        expect(await detectTransientsForClip('clip-1', 0.5)).toEqual({ status: 'failed', code: 'analysis-failed' });
        expect((await detectTransientsForClip('clip-1', 0.5)).status).toBe('complete');
    });
});

describe('scoped product preparation consumer', () => {
    beforeEach(() => {
        preferencesStore.trySet(defaultPreferences);
        mocks.root = 'root-1';
        mocks.tempo = 120;
        setElasticRootIdentityProvider(() => mocks.root);
        elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-1' });
        mocks.read.mockResolvedValue({
            status: 'complete',
            hits: [],
            identity: { clipId: 'clip-1' },
            isCurrent: () => true,
        });
    });
    afterEach(() => {
        cancelTransientDetection('clip-1');
        setElasticRootIdentityProvider(null);
        vi.restoreAllMocks();
        vi.useRealTimers();
    });
    it.each(['abort', 'editor', 'preference', 'pagehide'] as const)(
        'keeps cancellation ownership during an admitted consumer await: %s',
        async (kind) => {
            vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
            vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1);
            const cancelled = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
            const controller = new AbortController();
            const entered = Promise.withResolvers<void>();
            const request = detectTransientsForClip('clip-1', 0.5, controller.signal, async (_ready, lifetime) => {
                entered.resolve();
                return lifetime.waitForFrame();
            });
            await entered.promise;
            if (kind === 'abort') {
                controller.abort();
            }
            if (kind === 'editor') {
                elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-2' });
            }
            if (kind === 'preference') {
                preferencesStore.trySet({ ...defaultPreferences, elasticTransientSensitivity: 0.82 });
            }
            if (kind === 'pagehide') {
                window.dispatchEvent(new Event('pagehide'));
            }
            expect(await request).toEqual({ status: 'consumed', value: false });
            expect(cancelled).toHaveBeenCalled();
        }
    );
    it('settles the bounded request deadline without a frame and removes the consumer listeners', async () => {
        vi.useFakeTimers();
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
        vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1);
        vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
        const entered = Promise.withResolvers<void>();
        const request = detectTransientsForClip('clip-1', 0.5, undefined, async (_ready, lifetime) => {
            entered.resolve();
            return lifetime.waitForFrame();
        });
        await entered.promise;
        await vi.advanceTimersByTimeAsync(30_001);
        expect(await request).toEqual({ status: 'failed', code: 'analysis-timed-out' });
        expect(vi.getTimerCount()).toBe(0);
    });
    it.each(['success', 'refusal', 'consumer-error'] as const)(
        'disposes the exact source ownership observer on %s',
        async (outcome) => {
            const unsubscribe = vi.fn();
            const subscribe = vi.spyOn(trackStore, 'subscribe').mockReturnValue(unsubscribe);
            mocks.read.mockImplementationOnce(
                async (input: { observeSourceOwnership?: (current: () => boolean) => void }) => {
                    input.observeSourceOwnership?.(() => true);
                    if (outcome === 'refusal') {
                        return { status: 'failed', code: 'stale-source' };
                    }
                    return { status: 'complete', hits: [], identity: { clipId: 'clip-1' }, isCurrent: () => true };
                }
            );
            const request = detectTransientsForClip('clip-1', 0.5, undefined, async (ready) => {
                if (outcome === 'consumer-error') {
                    throw new Error('consumer stopped');
                }
                return ready.isCurrent();
            });
            if (outcome === 'consumer-error') {
                await expect(request).rejects.toThrow('consumer stopped');
            } else if (outcome === 'refusal') {
                expect(await request).toEqual({ status: 'failed', code: 'stale-source' });
            } else {
                expect(await request).toEqual({ status: 'consumed', value: true });
            }
            expect(subscribe).toHaveBeenCalledOnce();
            expect(unsubscribe).toHaveBeenCalledOnce();
        }
    );

    it('keeps source revocation latched through an awaited consumer and rejects aborted completion', async () => {
        let sourceCurrent = true;
        let sourceChanged: (() => void) | undefined;
        const unsubscribe = vi.fn();
        vi.spyOn(trackStore, 'subscribe').mockImplementation((listener) => {
            sourceChanged = () => listener(trackStore.value);
            return unsubscribe;
        });
        mocks.read.mockImplementationOnce(
            async (input: { observeSourceOwnership?: (current: () => boolean) => void }) => {
                input.observeSourceOwnership?.(() => sourceCurrent);
                return { status: 'complete', hits: [], identity: { clipId: 'clip-1' }, isCurrent: () => sourceCurrent };
            }
        );
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const request = detectTransientsForClip('clip-1', 0.5, undefined, async (ready, lifetime) => {
            entered.resolve();
            await release.promise;
            expect(lifetime.signal.aborted).toBe(true);
            expect(ready.completeUnchanged()).toBe(false);
            return ready.isCurrent();
        });
        await entered.promise;
        sourceChanged?.();
        sourceCurrent = false;
        sourceChanged?.();
        sourceCurrent = true;
        sourceChanged?.();
        release.resolve();
        expect(await request).toEqual({ status: 'consumed', value: false });
        expect(
            transientDetectionLifecycle.readCompletion('clip-1', transientDetectionLifecycle.revision('clip-1'))
        ).toBeUndefined();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('releases subscriptions on consumer error and permits a truthful retry', async () => {
        const editorRelease = vi.fn();
        const preferenceRelease = vi.fn();
        vi.spyOn(elasticAudioStore, 'subscribe').mockReturnValue(editorRelease);
        vi.spyOn(preferencesStore, 'subscribe').mockReturnValue(preferenceRelease);
        await expect(
            detectTransientsForClip('clip-1', 0.5, undefined, async () => {
                throw new Error('private preparation failed');
            })
        ).rejects.toThrow('private preparation failed');
        expect(editorRelease).toHaveBeenCalledOnce();
        expect(preferenceRelease).toHaveBeenCalledOnce();
        expect(await detectTransientsForClip('clip-1', 0.5, undefined, async (ready) => ready.isCurrent())).toEqual({
            status: 'consumed',
            value: true,
        });
    });
});
