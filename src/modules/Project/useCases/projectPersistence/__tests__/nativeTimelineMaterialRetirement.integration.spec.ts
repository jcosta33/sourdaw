import { describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
    clear: vi.fn<() => Promise<void>>(),
    repair: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    reset: vi.fn(),
    retirePlugins: vi.fn(async () => undefined),
    reopen: vi.fn(),
}));

// This is the public Project -> AudioEngine completion contract. Real native
// ownership and last-reader production are exercised in the native command specs.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    clearRuntimeCachedAudioBuffers: boundary.clear,
    disarmRetrospectiveCapture: vi.fn(),
    resetAudioGraph: boundary.reset,
}));
vi.mock('#/modules/Transport/useCases', () => ({
    preferencesSeededTransportState: vi.fn(),
    stopPlayback: boundary.stop,
    repairRuntimeGraphFromProject: boundary.repair,
}));
vi.mock('#/modules/PluginHost/useCases', () => ({
    beginProjectSessionPluginRetirement: async () => ({ retire: boundary.retirePlugins, reopen: boundary.reopen }),
}));
vi.mock('#/modules/Crumbs/useCases', () => ({ retractEveryCrumbsEngineAttachment: vi.fn() }));

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((complete) => {
        resolve = complete;
    });
    return { promise, resolve };
}

describe('project material retirement completion', () => {
    it('does not finish a quiesce or drop repair buffers while native readers remain pending', async () => {
        vi.resetModules();
        vi.clearAllMocks();
        const entered = deferred();
        const settled = deferred();
        boundary.clear.mockImplementationOnce(() => {
            entered.resolve();
            return settled.promise;
        });
        const { projectSessionQuiescer } = await import('../projectSessionQuiescer');
        const outgoing = projectSessionQuiescer.request(1, async () => true);
        await entered.promise;
        expect(boundary.clear).toHaveBeenCalledWith({ retainRuntimeBuffers: true });
        expect(boundary.reset).not.toHaveBeenCalled();
        expect(boundary.retirePlugins).not.toHaveBeenCalled();
        const cancelled = projectSessionQuiescer.cancel(1);
        settled.resolve();
        await expect(outgoing).resolves.toBe('rejected');
        await expect(cancelled).resolves.toBe('rejected');
        expect(boundary.repair).toHaveBeenCalledOnce();
        expect(boundary.reset).not.toHaveBeenCalled();
    });

    it('publishes terminal recovery when retirement fails and the old runtime cannot be reconstructed', async () => {
        vi.resetModules();
        vi.clearAllMocks();
        boundary.clear.mockRejectedValueOnce(new Error('native last reader timed out'));
        boundary.repair.mockRejectedValueOnce(new Error('runtime reconstruction refused'));
        const { projectSessionQuiescer } = await import('../projectSessionQuiescer');
        await expect(projectSessionQuiescer.request(2, async () => true)).resolves.toBe('terminal');
    });
});
