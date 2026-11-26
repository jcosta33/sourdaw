/**
 * The native host's re-attach report reaches the same correction a batch's
 * report gets (#7368): the instance is marked engine-attached and spliced into
 * the chain that names it.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AudioGraphAttachedPlugin } from '../../../models/AudioGraphBackend';
import { onNativePluginsAttached } from '../../../repositories/nativeGraph/onNativePluginsAttached';
import { nativeLiveGraphSessionSplice } from '../nativeLiveGraphSessionSplice';
import { watchNativePluginAttachments } from '../watchNativePluginAttachments';

const mocks = vi.hoisted(() => ({
    markExternalPluginEngineAttached: vi.fn(),
}));

vi.mock('../../../repositories/nativeGraph/onNativePluginsAttached', () => ({
    onNativePluginsAttached: vi.fn(),
}));
vi.mock('../nativeLiveGraphSessionSplice', () => ({
    nativeLiveGraphSessionSplice: vi.fn(),
}));
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/useCases')>();
    return { ...actual, markExternalPluginEngineAttached: mocks.markExternalPluginEngineAttached };
});

/** The watch holds one process-wide subscription, so it is started once and its handler kept. */
let push: (attached: readonly AudioGraphAttachedPlugin[]) => void = () => {};
let subscribeCalls = 0;

describe('watchNativePluginAttachments', () => {
    beforeAll(() => {
        vi.mocked(onNativePluginsAttached).mockImplementation((handler) => {
            push = handler;
            return Promise.resolve(() => {});
        });
        watchNativePluginAttachments();
        watchNativePluginAttachments();
        subscribeCalls = vi.mocked(onNativePluginsAttached).mock.calls.length;
    });

    beforeEach(() => {
        mocks.markExternalPluginEngineAttached.mockClear();
        vi.mocked(nativeLiveGraphSessionSplice).mockReset();
        vi.mocked(nativeLiveGraphSessionSplice).mockResolvedValue({ outcome: 'spliced' });
    });

    it('keeps one subscription however many session starts ask for it', () => {
        expect(subscribeCalls).toBe(1);
    });

    it('marks every instance the event names attached and splices each into its chain', () => {
        push([{ instanceId: 'inst-a' }, { instanceId: 'inst-b' }]);

        expect(mocks.markExternalPluginEngineAttached.mock.calls).toEqual([
            [{ instanceId: 'inst-a' }],
            [{ instanceId: 'inst-b' }],
        ]);
        expect(vi.mocked(nativeLiveGraphSessionSplice).mock.calls).toEqual([
            [{ instanceId: 'inst-a' }],
            [{ instanceId: 'inst-b' }],
        ]);
    });
});
