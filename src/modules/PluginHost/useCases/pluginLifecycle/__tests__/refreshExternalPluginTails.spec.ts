import { beforeEach, describe, expect, it, vi } from 'vitest';

import { countExternalPluginTailBookkeeping, externalPluginTailStore } from '../../../stores/externalPluginTailStore';
import { activateExternalPlugin } from '../activateExternalPlugin';
import { clearLoadedExternalPlugins } from '../clearLoadedExternalPlugins';
import { forgetRetiredPluginInstances } from '../forgetRetiredPluginInstances';
import { refreshExternalPluginTails } from '../refreshExternalPluginTails';
import { unloadPlugin } from '../unloadPlugin';

import type { PluginInstance, PluginTailChange, PluginTailReading } from '../../../repositories/pluginBridge/types';

// A VST3 plugin raises no tail-changed event, so the figure is re-read on
// demand: the real activation and unload use cases down to the IPC repository
// boundary, which is mocked.
const mocks = vi.hoisted(() => ({
    loadPluginRepo: vi.fn<(pluginId: string, instanceId: string) => Promise<PluginInstance>>(),
    unloadPluginRepo: vi.fn<(instanceId?: string) => Promise<unknown>>(),
    readPluginTailsRepo: vi.fn<(instanceIds: readonly string[]) => Promise<PluginTailReading[] | 'timed-out'>>(),
    loggerWarn: vi.fn<(message: string) => void>(),
}));

vi.mock('../../../repositories/pluginBridge/loadPlugin', () => ({ loadPlugin: mocks.loadPluginRepo }));
vi.mock('../../../repositories/pluginBridge/unloadPlugin', () => ({ unloadPlugin: mocks.unloadPluginRepo }));
// The specs answer in readings, or 'timed-out' for a host that did not answer in time.
vi.mock('../../../repositories/pluginBridge/readPluginTails', () => ({
    readPluginTails: async (instanceIds: readonly string[]) => {
        const answer = await mocks.readPluginTailsRepo(instanceIds);
        return answer === 'timed-out' ? { kind: 'timed-out' } : { kind: 'answered', readings: answer };
    },
}));
vi.mock('../../../repositories/pluginBridge/onPluginTailChanged', () => ({
    onPluginTailChanged: (handler: (change: PluginTailChange) => void) => {
        nativeTailHandler = handler;
        return Promise.resolve(() => {});
    },
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: mocks.loggerWarn } }));

/** The handler the single live `plugin-tail-changed` subscription installed. */
let nativeTailHandler: ((change: PluginTailChange) => void) | undefined;

function emitTailChange(change: PluginTailChange): void {
    if (!nativeTailHandler) {
        throw new Error('no native tail subscription is live');
    }
    nativeTailHandler(change);
}

function loadedInstance(instanceId: string, tailSamples: number): PluginInstance {
    return {
        instance_id: instanceId,
        plugin_id: 'reverb',
        name: 'Reverb',
        parameters: [],
        is_active: true,
        latency_samples: 0,
        latency_ms: 0,
        tail_samples: tailSamples,
        tail_sequence: 0,
        engine_plugin_id: 7,
    };
}

/** One host reading: the host numbers every read and event from one counter. */
function reading(instanceId: string, tailSamples: number, sequence: number): PluginTailReading {
    return { instance_id: instanceId, tail_samples: tailSamples, sequence };
}

function tailOf(instanceId: string): number | undefined {
    return externalPluginTailStore.value?.tailSamplesByInstanceId[instanceId];
}

describe('refreshExternalPluginTails', () => {
    beforeEach(() => {
        clearLoadedExternalPlugins();
        vi.clearAllMocks();
        mocks.unloadPluginRepo.mockImplementation((instanceId) =>
            Promise.resolve({
                unloadedInstanceIds: instanceId === undefined ? [] : [instanceId],
                errors: [],
                reports: [],
            })
        );
        mocks.loadPluginRepo.mockImplementation((_pluginId, instanceId) =>
            Promise.resolve(loadedInstance(instanceId, 96_000))
        );
    });

    it('revises a loaded instance to the tail the host reads now', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        mocks.readPluginTailsRepo.mockResolvedValue([reading('inst-1', 240_000, 1)]);

        await refreshExternalPluginTails();

        expect(mocks.readPluginTailsRepo).toHaveBeenCalledWith(['inst-1']);
        expect(tailOf('inst-1')).toBe(240_000);
    });

    it('keeps the stored tail of an instance the host left out of both its answer and its retry', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-2' });
        mocks.readPluginTailsRepo.mockResolvedValueOnce([reading('inst-2', 48_000, 1)]).mockResolvedValue([]);

        await refreshExternalPluginTails();

        expect(tailOf('inst-1')).toBe(96_000);
        expect(tailOf('inst-2')).toBe(48_000);
        expect(mocks.readPluginTailsRepo.mock.calls).toEqual([[['inst-1', 'inst-2']], [['inst-1']]]);
    });

    it('reads an instance the host could not reach once more and publishes what the retry answers', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-2' });
        mocks.readPluginTailsRepo
            .mockResolvedValueOnce([reading('inst-2', 48_000, 1)])
            .mockResolvedValueOnce([reading('inst-1', 240_000, 2)]);

        await refreshExternalPluginTails();

        expect(mocks.readPluginTailsRepo).toHaveBeenNthCalledWith(2, ['inst-1']);
        expect(tailOf('inst-1')).toBe(240_000);
    });

    it('does not ask a host that timed out again and keeps every stored tail', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        mocks.readPluginTailsRepo.mockResolvedValue('timed-out');

        await refreshExternalPluginTails();

        expect(mocks.readPluginTailsRepo).toHaveBeenCalledTimes(1);
        expect(tailOf('inst-1')).toBe(96_000);
    });

    it('makes no retry when the host answered every instance', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        mocks.readPluginTailsRepo.mockResolvedValue([reading('inst-1', 240_000, 1)]);

        await refreshExternalPluginTails();

        expect(mocks.readPluginTailsRepo).toHaveBeenCalledTimes(1);
    });

    it('does not revive an instance unloaded while the host was answering', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        const answer = Promise.withResolvers<PluginTailReading[]>();
        mocks.readPluginTailsRepo.mockReturnValue(answer.promise);

        const refresh = refreshExternalPluginTails();
        await vi.waitFor(() => expect(mocks.readPluginTailsRepo).toHaveBeenCalledTimes(1));
        await unloadPlugin('inst-1');
        answer.resolve([reading('inst-1', 240_000, 1)]);
        await refresh;

        expect(tailOf('inst-1')).toBeUndefined();
    });

    it('does not let an older refresh that resolves last overwrite a newer one', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        const olderAnswer = Promise.withResolvers<PluginTailReading[]>();
        const newerAnswer = Promise.withResolvers<PluginTailReading[]>();
        mocks.readPluginTailsRepo.mockReturnValueOnce(olderAnswer.promise).mockReturnValueOnce(newerAnswer.promise);

        const older = refreshExternalPluginTails();
        const newer = refreshExternalPluginTails();
        newerAnswer.resolve([reading('inst-1', 240_000, 2)]);
        await newer;
        olderAnswer.resolve([reading('inst-1', 48_000, 1)]);
        await older;

        expect(tailOf('inst-1')).toBe(240_000);
    });

    it('lets the later refresh win when the older one answers first', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        const olderAnswer = Promise.withResolvers<PluginTailReading[]>();
        const newerAnswer = Promise.withResolvers<PluginTailReading[]>();
        mocks.readPluginTailsRepo.mockReturnValueOnce(olderAnswer.promise).mockReturnValueOnce(newerAnswer.promise);

        const older = refreshExternalPluginTails();
        const newer = refreshExternalPluginTails();
        olderAnswer.resolve([reading('inst-1', 48_000, 1)]);
        await older;
        newerAnswer.resolve([reading('inst-1', 240_000, 2)]);
        await newer;

        expect(tailOf('inst-1')).toBe(240_000);
    });

    it('does not overwrite a tail the plugin announced after the host read the answer', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        const answer = Promise.withResolvers<PluginTailReading[]>();
        mocks.readPluginTailsRepo.mockReturnValueOnce(answer.promise);

        const refresh = refreshExternalPluginTails();
        emitTailChange({ instance_id: 'inst-1', tail_samples: 300_000, sequence: 6 });
        answer.resolve([reading('inst-1', 240_000, 5)]);
        await refresh;

        expect(tailOf('inst-1')).toBe(300_000);
    });

    it('lets an answer the host read after an event the host emitted earlier replace it, however late the event arrived', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        const answer = Promise.withResolvers<PluginTailReading[]>();
        mocks.readPluginTailsRepo.mockReturnValueOnce(answer.promise);

        const refresh = refreshExternalPluginTails();
        // Delivered after the read was issued, but numbered before the read ran.
        emitTailChange({ instance_id: 'inst-1', tail_samples: 240_000, sequence: 3 });
        answer.resolve([reading('inst-1', 300_000, 4)]);
        await refresh;

        expect(tailOf('inst-1')).toBe(300_000);
    });

    it('ignores an event the host emitted before an answer that already landed', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        mocks.readPluginTailsRepo.mockResolvedValue([reading('inst-1', 300_000, 8)]);
        await refreshExternalPluginTails();

        emitTailChange({ instance_id: 'inst-1', tail_samples: 240_000, sequence: 5 });

        expect(tailOf('inst-1')).toBe(300_000);
    });

    it('does not give an instance reloaded under the same id the old runtime figure', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        const answer = Promise.withResolvers<PluginTailReading[]>();
        mocks.readPluginTailsRepo.mockReturnValueOnce(answer.promise);

        const refresh = refreshExternalPluginTails();
        await unloadPlugin('inst-1');
        mocks.loadPluginRepo.mockImplementationOnce((_pluginId, instanceId) =>
            Promise.resolve(loadedInstance(instanceId, 50_000))
        );
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        answer.resolve([reading('inst-1', 240_000, 1)]);
        await refresh;

        expect(tailOf('inst-1')).toBe(50_000);
    });

    it('does not give an instance reactivated after a graph rebuild the old runtime figure', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        const answer = Promise.withResolvers<PluginTailReading[]>();
        mocks.readPluginTailsRepo.mockReturnValueOnce(answer.promise);

        const refresh = refreshExternalPluginTails();
        clearLoadedExternalPlugins();
        mocks.loadPluginRepo.mockImplementationOnce((_pluginId, instanceId) =>
            Promise.resolve(loadedInstance(instanceId, 50_000))
        );
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        answer.resolve([reading('inst-1', 240_000, 1)]);
        await refresh;

        expect(tailOf('inst-1')).toBe(50_000);
    });

    it('does not hold the old runtime figure for a successor still loading after a graph rebuild', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        const answer = Promise.withResolvers<PluginTailReading[]>();
        mocks.readPluginTailsRepo.mockReturnValueOnce(answer.promise);
        const refresh = refreshExternalPluginTails();
        clearLoadedExternalPlugins();
        const successorLoad = Promise.withResolvers<PluginInstance>();
        mocks.loadPluginRepo.mockReturnValueOnce(successorLoad.promise);
        const successor = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });

        answer.resolve([reading('inst-1', 240_000, 1)]);
        await refresh;
        successorLoad.resolve(loadedInstance('inst-1', 50_000));
        await successor;

        expect(tailOf('inst-1')).toBe(50_000);
    });

    it('drops an answer to a read issued while the instance was loading once the load has seeded it', async () => {
        const load = Promise.withResolvers<PluginInstance>();
        mocks.loadPluginRepo.mockReturnValueOnce(load.promise);
        const activation = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        const answer = Promise.withResolvers<PluginTailReading[]>();
        mocks.readPluginTailsRepo.mockReturnValueOnce(answer.promise);
        const refresh = refreshExternalPluginTails();

        load.resolve(loadedInstance('inst-1', 96_000));
        await activation;
        answer.resolve([reading('inst-1', 240_000, 3)]);
        await refresh;

        expect(tailOf('inst-1')).toBe(96_000);
    });

    describe('an instance whose load has not returned', () => {
        it('holds the answer and seeds it over the figure the load reports', async () => {
            const load = Promise.withResolvers<PluginInstance>();
            mocks.loadPluginRepo.mockReturnValueOnce(load.promise);
            const activation = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
            mocks.readPluginTailsRepo.mockResolvedValue([reading('inst-1', 240_000, 7)]);

            await refreshExternalPluginTails();
            const tailBeforeSeed = tailOf('inst-1');
            load.resolve(loadedInstance('inst-1', 96_000));
            await activation;

            expect(tailBeforeSeed).toBeUndefined();
            expect(tailOf('inst-1')).toBe(240_000);
        });

        it('lets a held event with a later sequence win over a held answer', async () => {
            const load = Promise.withResolvers<PluginInstance>();
            mocks.loadPluginRepo.mockReturnValueOnce(load.promise);
            const activation = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
            mocks.readPluginTailsRepo.mockResolvedValue([reading('inst-1', 240_000, 7)]);

            emitTailChange({ instance_id: 'inst-1', tail_samples: 500_000, sequence: 9 });
            await refreshExternalPluginTails();
            load.resolve(loadedInstance('inst-1', 96_000));
            await activation;

            expect(tailOf('inst-1')).toBe(500_000);
        });

        it('creates no entry and keeps nothing when the load then fails', async () => {
            const load = Promise.withResolvers<PluginInstance>();
            mocks.loadPluginRepo.mockReturnValueOnce(load.promise);
            const activation = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
            mocks.readPluginTailsRepo.mockResolvedValue([reading('inst-1', 240_000, 7)]);

            await refreshExternalPluginTails();
            load.reject(new Error('load failed'));
            await activation;
            await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });

            expect(tailOf('inst-1')).toBe(96_000);
        });

        it('drops an answer for an instance that is no longer loaded', async () => {
            const load = Promise.withResolvers<PluginInstance>();
            mocks.loadPluginRepo.mockReturnValueOnce(load.promise);
            const activation = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
            const answer = Promise.withResolvers<PluginTailReading[]>();
            mocks.readPluginTailsRepo.mockReturnValueOnce(answer.promise);
            const refresh = refreshExternalPluginTails();
            load.reject(new Error('load failed'));
            await activation;

            answer.resolve([reading('inst-1', 240_000, 7)]);
            await refresh;
            await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });

            expect(tailOf('inst-1')).toBe(96_000);
        });

        it('does not hold the answer a read issued before a graph rebuild gets for the successor', async () => {
            const firstLoad = Promise.withResolvers<PluginInstance>();
            const successorLoad = Promise.withResolvers<PluginInstance>();
            mocks.loadPluginRepo.mockReturnValueOnce(firstLoad.promise).mockReturnValueOnce(successorLoad.promise);
            const first = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
            const answer = Promise.withResolvers<PluginTailReading[]>();
            mocks.readPluginTailsRepo.mockReturnValueOnce(answer.promise);
            const refresh = refreshExternalPluginTails();

            clearLoadedExternalPlugins();
            const successor = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
            answer.resolve([reading('inst-1', 240_000, 7)]);
            await refresh;
            firstLoad.resolve(loadedInstance('inst-1', 48_000));
            await first;
            successorLoad.resolve(loadedInstance('inst-1', 50_000));
            await successor;

            expect(tailOf('inst-1')).toBe(50_000);
        });

        it('does not hold the answer a read issued for a forgotten predecessor gets', async () => {
            const firstLoad = Promise.withResolvers<PluginInstance>();
            const successorLoad = Promise.withResolvers<PluginInstance>();
            mocks.loadPluginRepo.mockReturnValueOnce(firstLoad.promise).mockReturnValueOnce(successorLoad.promise);
            const first = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
            const answer = Promise.withResolvers<PluginTailReading[]>();
            mocks.readPluginTailsRepo.mockReturnValueOnce(answer.promise);
            const refresh = refreshExternalPluginTails();

            forgetRetiredPluginInstances(['inst-1']);
            const successor = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
            answer.resolve([reading('inst-1', 240_000, 7)]);
            await refresh;
            firstLoad.resolve(loadedInstance('inst-1', 48_000));
            await first;
            successorLoad.resolve(loadedInstance('inst-1', 50_000));
            await successor;

            expect(tailOf('inst-1')).toBe(50_000);
        });
    });

    it('keeps every stored tail and warns when the read is rejected', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        mocks.readPluginTailsRepo.mockRejectedValue(new Error('host unavailable'));

        await expect(refreshExternalPluginTails()).resolves.toBeUndefined();

        expect(tailOf('inst-1')).toBe(96_000);
        expect(mocks.loggerWarn).toHaveBeenCalledWith(expect.stringContaining('host unavailable'));
    });

    it('makes no IPC call when nothing is loaded', async () => {
        await refreshExternalPluginTails();

        expect(mocks.readPluginTailsRepo).not.toHaveBeenCalled();
    });

    describe('bookkeeping for forgotten instances', () => {
        it('keeps no stamp or sequence for an instance forgotten with no read in flight', async () => {
            mocks.readPluginTailsRepo.mockResolvedValue([reading('inst-1', 240_000, 1)]);
            await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
            await refreshExternalPluginTails();
            expect(countExternalPluginTailBookkeeping()).toBe(1);

            await unloadPlugin('inst-1');

            expect(countExternalPluginTailBookkeeping()).toBe(0);
        });

        it('keeps the stamp while a read for the forgotten instance is in flight, then prunes it', async () => {
            await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
            const answer = Promise.withResolvers<PluginTailReading[]>();
            mocks.readPluginTailsRepo.mockReturnValueOnce(answer.promise);
            const refresh = refreshExternalPluginTails();

            await unloadPlugin('inst-1');
            const keptWhileReading = countExternalPluginTailBookkeeping();
            answer.resolve([reading('inst-1', 240_000, 1)]);
            await refresh;

            expect(keptWhileReading).toBe(1);
            expect(countExternalPluginTailBookkeeping()).toBe(0);
            expect(tailOf('inst-1')).toBeUndefined();
        });
    });
});
