import { describe, expect, it, vi } from 'vitest';

// Hoisted so the same vi.fn instances survive `vi.resetModules()`: the
// factories re-run when a reset sends the next scenario through them, but
// they keep handing out these.
const mocks = vi.hoisted(() => ({
    clearRuntimeCachedAudioBuffers: vi.fn(async () => undefined),
    disarmRetrospectiveCapture: vi.fn(),
    resetAudioGraph: vi.fn(),
    retractEveryEngineAttachment: vi.fn(),
    beginProjectSessionPluginRetirement: vi.fn(),
    repairRuntimeGraphFromProject: vi.fn(),
    stopPlayback: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    clearRuntimeCachedAudioBuffers: mocks.clearRuntimeCachedAudioBuffers,
    disarmRetrospectiveCapture: mocks.disarmRetrospectiveCapture,
    resetAudioGraph: mocks.resetAudioGraph,
    engineAttachmentTracking: { read: () => ({ retractEveryAttachment: mocks.retractEveryEngineAttachment }) },
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    beginProjectSessionPluginRetirement: mocks.beginProjectSessionPluginRetirement,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    preferencesSeededTransportState: vi.fn(),
    repairRuntimeGraphFromProject: mocks.repairRuntimeGraphFromProject,
    stopPlayback: mocks.stopPlayback,
}));

vi.mock('../../../stores/projectLoadFailureStore', () => ({
    projectLoadFailureStore: { set: vi.fn() },
}));

vi.mock('../../../stores/projectStore', () => ({
    projectStore: { value: null },
}));

// The quiescer keeps its request state at module scope, so every scenario
// loads a fresh instance.
async function loadQuiescer() {
    vi.resetModules();
    const module = await import('../projectSessionQuiescer');
    vi.clearAllMocks();
    mocks.clearRuntimeCachedAudioBuffers.mockReset().mockResolvedValue(undefined);
    return module.projectSessionQuiescer;
}

const resolvePluginRetirement = () => {
    const retirement = {
        reopen: vi.fn(),
        release: vi.fn(),
        retire: vi.fn(async () => undefined),
    };
    mocks.beginProjectSessionPluginRetirement.mockResolvedValue(retirement);
    return retirement;
};

// Audit #4591 retrospective capture — a committed session teardown must
// disarm: a punch arm that outlives its renderer keeps the engine's ring
// retaining input audio with no window open (#4752).
describe('projectSessionQuiescer — the recorded arm does not outlive the session', () => {
    it('a committed quiesce disarms the retrospective ring before it reports success', async () => {
        const quiescer = await loadQuiescer();
        resolvePluginRetirement();

        const outcome = await quiescer.request(1, async () => true);

        expect(outcome).toBe('success');
        expect(mocks.disarmRetrospectiveCapture).toHaveBeenCalledOnce();
        // After the engine teardown it sits beside, and before the quiesce is
        // reported committed: the ring stops retaining on the way down.
        expect(mocks.disarmRetrospectiveCapture.mock.invocationCallOrder[0]).toBeGreaterThan(
            mocks.retractEveryEngineAttachment.mock.invocationCallOrder[0] ?? 0
        );
    });

    it('a teardown the session rejected keeps the arm', async () => {
        const quiescer = await loadQuiescer();
        resolvePluginRetirement();

        const outcome = await quiescer.request(1, async () => false);

        expect(outcome).toBe('rejected');
        expect(mocks.disarmRetrospectiveCapture).not.toHaveBeenCalled();
    });

    it('a teardown cancelled mid-flight keeps the arm and repairs instead', async () => {
        const quiescer = await loadQuiescer();
        let releaseRetirement: (() => void) | undefined;
        mocks.beginProjectSessionPluginRetirement.mockReturnValue(
            new Promise((resolve) => {
                releaseRetirement = () =>
                    resolve({
                        reopen: vi.fn(),
                        release: vi.fn(),
                        retire: vi.fn(async () => undefined),
                    });
            })
        );

        const quiescing = quiescer.request(1, async () => true);
        releaseRetirement?.();
        const cancelled = await quiescer.cancel(1);
        const outcome = await quiescing;

        expect(outcome).toBe('rejected');
        expect(cancelled).toBe('rejected');
        expect(mocks.repairRuntimeGraphFromProject).toHaveBeenCalled();
        expect(mocks.disarmRetrospectiveCapture).not.toHaveBeenCalled();
    });
});

// #6866: a cancelled quiesce reopens the plugin retirement, which keeps the
// live state it carried for the repair's rebuild; only a session that really
// ended releases it, which drops every carry.
describe('projectSessionQuiescer — live plugin state across a cancelled quiesce', () => {
    it('touches no plugin retirement when the cancellation lands before retirement begins', async () => {
        const quiescer = await loadQuiescer();
        resolvePluginRetirement();

        const outcome = await quiescer.request(1, async () => {
            void quiescer.cancel(1);
            return true;
        });

        expect(outcome).toBe('rejected');
        expect(mocks.beginProjectSessionPluginRetirement).not.toHaveBeenCalled();
        expect(mocks.repairRuntimeGraphFromProject).toHaveBeenCalledOnce();
    });

    it('reopens without retiring when the cancellation lands during the buffer clear', async () => {
        const quiescer = await loadQuiescer();
        const retirement = resolvePluginRetirement();
        mocks.clearRuntimeCachedAudioBuffers.mockImplementationOnce(async () => {
            void quiescer.cancel(1);
        });

        await expect(quiescer.request(1, async () => true)).resolves.toBe('rejected');

        expect(retirement.retire).not.toHaveBeenCalled();
        expect(retirement.reopen).toHaveBeenCalledOnce();
        expect(retirement.release).not.toHaveBeenCalled();
        expect(retirement.reopen.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.repairRuntimeGraphFromProject.mock.invocationCallOrder[0] ?? 0
        );
    });

    it('reopens, keeping the carried live state, before the repair rebuilds when the cancellation lands during retirement', async () => {
        const quiescer = await loadQuiescer();
        const retirement = resolvePluginRetirement();
        retirement.retire.mockImplementationOnce(async () => {
            void quiescer.cancel(1);
        });

        await expect(quiescer.request(1, async () => true)).resolves.toBe('rejected');

        expect(retirement.retire).toHaveBeenCalledOnce();
        expect(retirement.reopen).toHaveBeenCalledOnce();
        expect(retirement.release).not.toHaveBeenCalled();
        expect(retirement.reopen.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.repairRuntimeGraphFromProject.mock.invocationCallOrder[0] ?? 0
        );
    });

    it('reopens rather than releases when a completed quiesce is cancelled before the window closes', async () => {
        const quiescer = await loadQuiescer();
        const retirement = resolvePluginRetirement();

        await expect(quiescer.request(1, async () => true)).resolves.toBe('success');
        expect(retirement.reopen).not.toHaveBeenCalled();
        expect(retirement.release).not.toHaveBeenCalled();
        await expect(quiescer.cancel(1)).resolves.toBe('rejected');

        expect(retirement.reopen).toHaveBeenCalledOnce();
        expect(retirement.release).not.toHaveBeenCalled();
    });

    it('releases the carried live state once the window is destroyed', async () => {
        const quiescer = await loadQuiescer();
        const retirement = resolvePluginRetirement();

        await expect(quiescer.request(1, async () => true)).resolves.toBe('success');
        quiescer.releaseAfterWindowDestroy();

        expect(retirement.release).toHaveBeenCalledOnce();
        expect(retirement.reopen).not.toHaveBeenCalled();
    });
});
