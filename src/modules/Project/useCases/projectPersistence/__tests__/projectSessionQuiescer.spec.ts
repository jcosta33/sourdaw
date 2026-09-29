import { describe, expect, it, vi } from 'vitest';

// Hoisted so the same vi.fn instances survive `vi.resetModules()`: the
// factories re-run when a reset sends the next scenario through them, but
// they keep handing out these.
const mocks = vi.hoisted(() => ({
    disarmRetrospectiveCapture: vi.fn(),
    resetAudioGraph: vi.fn(),
    retractEveryCrumbsEngineAttachment: vi.fn(),
    beginProjectSessionPluginRetirement: vi.fn(),
    repairRuntimeGraphFromProject: vi.fn(),
    stopPlayback: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    disarmRetrospectiveCapture: mocks.disarmRetrospectiveCapture,
    resetAudioGraph: mocks.resetAudioGraph,
}));

vi.mock('#/modules/Crumbs/useCases', () => ({
    retractEveryCrumbsEngineAttachment: mocks.retractEveryCrumbsEngineAttachment,
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    beginProjectSessionPluginRetirement: mocks.beginProjectSessionPluginRetirement,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    repairRuntimeGraphFromProject: mocks.repairRuntimeGraphFromProject,
    stopPlayback: mocks.stopPlayback,
}));

vi.mock('../../stores/projectLoadFailureStore', () => ({
    projectLoadFailureStore: { set: vi.fn() },
}));

vi.mock('../../stores/projectStore', () => ({
    projectStore: { value: null },
}));

// The quiescer keeps its request state at module scope, so every scenario
// loads a fresh instance.
async function loadQuiescer() {
    vi.resetModules();
    const module = await import('../projectSessionQuiescer');
    vi.clearAllMocks();
    return module.projectSessionQuiescer;
}

const resolvePluginRetirement = (): void => {
    mocks.beginProjectSessionPluginRetirement.mockResolvedValue({
        reopen: vi.fn(),
        retire: vi.fn(async () => undefined),
    });
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
            mocks.retractEveryCrumbsEngineAttachment.mock.invocationCallOrder[0] ?? 0
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
