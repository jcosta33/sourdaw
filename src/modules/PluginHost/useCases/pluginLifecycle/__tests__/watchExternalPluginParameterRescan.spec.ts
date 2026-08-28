import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type PluginParametersRescanned } from '../../../repositories/pluginBridge/types';

vi.mock('../../../repositories/pluginBridge/onPluginParametersRescanned', () => ({
    onPluginParametersRescanned: vi.fn(),
}));

vi.mock('../refreshExternalPluginParameters', () => ({
    refreshExternalPluginParameters: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Load a fresh copy of the use case. It holds one process-wide subscription on
 * purpose, so a second test running against the first test's listener would see
 * a call count it did not make.
 */
async function freshWatcher(): Promise<{
    start: () => void;
    push: (rescanned: PluginParametersRescanned) => void;
    refresh: ReturnType<typeof vi.fn>;
    subscribeCalls: () => number;
}> {
    vi.resetModules();
    const { onPluginParametersRescanned } =
        await import('../../../repositories/pluginBridge/onPluginParametersRescanned');
    const { refreshExternalPluginParameters } = await import('../refreshExternalPluginParameters');
    let push: (rescanned: PluginParametersRescanned) => void = () => {};
    vi.mocked(onPluginParametersRescanned).mockReset();
    vi.mocked(onPluginParametersRescanned).mockImplementation((handler) => {
        push = handler;
        return Promise.resolve(() => {});
    });
    vi.mocked(refreshExternalPluginParameters).mockClear();

    const module = await import('../watchExternalPluginParameterRescan');

    return {
        start: module.watchExternalPluginParameterRescan,
        push: (rescanned) => push(rescanned),
        refresh: vi.mocked(refreshExternalPluginParameters),
        subscribeCalls: () => vi.mocked(onPluginParametersRescanned).mock.calls.length,
    };
}

describe('watchExternalPluginParameterRescan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    /// Without this the automation menu keeps offering the names and ranges the
    /// plugin had at load time, and a lane resolves against a contract the
    /// plugin has replaced.
    it('re-reads the contract of the instance whose plugin announced the change', async () => {
        const watcher = await freshWatcher();
        watcher.start();

        watcher.push({ instance_id: 'inst-1' });

        expect(watcher.refresh).toHaveBeenCalledWith('inst-1');
    });

    it('re-reads nothing for an instance the host did not name', async () => {
        const watcher = await freshWatcher();
        watcher.start();

        expect(watcher.refresh).not.toHaveBeenCalled();
    });

    /// The native event is a broadcast: a second subscription would run one
    /// plugin's rescan twice, and every other loaded plugin's rescans twice too.
    it('keeps one subscription however many activations ask for it', async () => {
        const watcher = await freshWatcher();

        watcher.start();
        watcher.start();
        watcher.start();

        expect(watcher.subscribeCalls()).toBe(1);
    });
});
