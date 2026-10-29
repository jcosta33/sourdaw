import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';
import { elasticAudioStore, defaultElasticAudioState } from '../../../stores/elasticAudio';
import { cancelTransientDetection, detectTransientsForClip } from '../detectTransientsForClip';
import { setElasticRootIdentityProvider } from '../setElasticRootIdentityProvider';

const mocks = vi.hoisted(() => ({ read: vi.fn(), root: 'root-1', tempo: 120 }));
vi.mock('../readClipTransientOnsets', () => ({ readProductTransientOnsets: mocks.read }));
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
    it('propagates Worker failure and allows retry', async () => {
        mocks.read.mockResolvedValueOnce({ status: 'failed', code: 'analysis-failed' });
        expect(await detectTransientsForClip('clip-1', 0.5)).toEqual({ status: 'failed', code: 'analysis-failed' });
        expect((await detectTransientsForClip('clip-1', 0.5)).status).toBe('complete');
    });
});
