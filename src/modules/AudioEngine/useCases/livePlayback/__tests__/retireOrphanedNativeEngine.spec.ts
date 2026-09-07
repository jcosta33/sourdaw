/**
 * What the renderer does with the engine slot a stalled session left behind
 * (#3960).
 *
 * The doubled boundary is `retireNativeEngine`, the repository root that owns
 * the command, and `#/modules/PluginHost/useCases`, the foreign contract this
 * use case reaches for. Everything else is real: the session state it clears
 * and the store it publishes the offer on are what a caller observes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultNativeEngineRearmState, nativeEngineRearmStore } from '../../../stores/nativeEngineRearmStore';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { retireOrphanedNativeEngine } from '../retireOrphanedNativeEngine';

import type { AudioGraphBackend } from '../../../models/AudioGraphBackend';
import type { RetireNativeEngineResult } from '../../../models/RetireNativeEngineOutcome';

const mocks = vi.hoisted(() => ({
    retireNativeEngine: vi.fn<() => Promise<RetireNativeEngineResult>>(),
    forgetRetiredPluginInstances: vi.fn<(instanceIds: readonly string[]) => void>(),
    warn: vi.fn(),
}));

vi.mock('../../../repositories/engineLifecycle/retireNativeEngine', () => ({
    retireNativeEngine: () => mocks.retireNativeEngine(),
}));
vi.mock('#/modules/PluginHost/useCases', () => ({
    forgetRetiredPluginInstances: (instanceIds: readonly string[]) => mocks.forgetRetiredPluginInstances(instanceIds),
}));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: mocks.warn, info: vi.fn(), debug: vi.fn() },
}));

function fakeBackend(): AudioGraphBackend & { dispose: ReturnType<typeof vi.fn<() => void>> } {
    return {
        backendId: 'stub-backend',
        apply: vi.fn<AudioGraphBackend['apply']>(),
        dispose: vi.fn<() => void>(),
    };
}

function offers(): number {
    return (nativeEngineRearmStore.value ?? defaultNativeEngineRearmState).offers;
}

describe('retireOrphanedNativeEngine', () => {
    beforeEach(() => {
        mocks.retireNativeEngine.mockReset();
        mocks.forgetRetiredPluginInstances.mockReset();
        mocks.warn.mockClear();
        nativeEngineRearmStore.set(defaultNativeEngineRearmState);
        nativeLiveGraphSession.backend = null;
        nativeLiveGraphSession.orphanedBackend = null;
        nativeLiveGraphSession.pending = Promise.resolve();
    });

    it('drops the orphan, forgets the instances it destroyed, and offers a re-arm', async () => {
        const orphan = fakeBackend();
        nativeLiveGraphSession.orphanedBackend = orphan;
        mocks.retireNativeEngine.mockResolvedValue({
            outcome: 'retired',
            retiredInstanceIds: ['inst-1', 'inst-2'],
        });

        await retireOrphanedNativeEngine();

        expect(orphan.dispose).toHaveBeenCalledTimes(1);
        expect(nativeLiveGraphSession.orphanedBackend).toBeNull();
        expect(mocks.forgetRetiredPluginInstances).toHaveBeenCalledWith(['inst-1', 'inst-2']);
        expect(offers()).toBe(1);
    });

    it('drops a spent orphan on an empty slot without offering anything to re-arm', async () => {
        const orphan = fakeBackend();
        nativeLiveGraphSession.orphanedBackend = orphan;
        mocks.retireNativeEngine.mockResolvedValue({ outcome: 'no-engine', retiredInstanceIds: [] });

        await retireOrphanedNativeEngine();

        expect(orphan.dispose).toHaveBeenCalledTimes(1);
        expect(nativeLiveGraphSession.orphanedBackend).toBeNull();
        // Nothing was retired, so there is nothing to reload and no session to
        // rebuild on this musician's behalf.
        expect(mocks.forgetRetiredPluginInstances).not.toHaveBeenCalled();
        expect(offers()).toBe(0);
    });

    it('keeps the orphan when the engine came back between the reading and the command', async () => {
        const orphan = fakeBackend();
        nativeLiveGraphSession.orphanedBackend = orphan;
        mocks.retireNativeEngine.mockResolvedValue({ outcome: 'rendering', retiredInstanceIds: [] });

        await retireOrphanedNativeEngine();

        // The park arm owns a rendering engine, and it needs this handle.
        expect(orphan.dispose).not.toHaveBeenCalled();
        expect(nativeLiveGraphSession.orphanedBackend).toBe(orphan);
        expect(offers()).toBe(0);
    });

    it('keeps the orphan when the command answers unreadably', async () => {
        const orphan = fakeBackend();
        nativeLiveGraphSession.orphanedBackend = orphan;
        mocks.retireNativeEngine.mockRejectedValue(new Error('unrecognized retire_native_engine outcome: undefined'));

        await retireOrphanedNativeEngine();

        expect(orphan.dispose).not.toHaveBeenCalled();
        expect(nativeLiveGraphSession.orphanedBackend).toBe(orphan);
        expect(offers()).toBe(0);
        expect(mocks.warn).toHaveBeenCalledTimes(1);
        const [warning] = mocks.warn.mock.calls[0] as [string];
        expect(warning).toContain('orphan retire');
    });

    it('sends no command when there is no orphan to retire', async () => {
        await retireOrphanedNativeEngine();

        expect(mocks.retireNativeEngine).not.toHaveBeenCalled();
        expect(offers()).toBe(0);
    });
});
