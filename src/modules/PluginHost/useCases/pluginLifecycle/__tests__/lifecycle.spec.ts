import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loadedExternalInstances } from '../loadedExternalInstances';
import { loadPlugin } from '../loadPlugin';
import { openPluginGui } from '../openPluginGui';
import { pluginLifecycleScheduler } from '../serializePluginLifecycle';
import { unloadPlugin } from '../unloadPlugin';

import type { unloadPlugin as unloadPluginRepoSignature } from '../../../repositories/pluginBridge/unloadPlugin';

const mocks = vi.hoisted(() => ({
    loadPluginRepo: vi.fn(),
    unloadPluginRepo: vi.fn<typeof unloadPluginRepoSignature>(),
    openPluginGuiRepo: vi.fn(),
}));

const pluginInstance = {
    instance_id: 'inst1',
    plugin_id: 'p1',
    name: 'Plugin',
    parameters: [],
    is_active: true,
    latency_samples: 0,
};

/**
 * Advance the microtask queue past every hop of one serialized lifecycle turn.
 * Each operation in the scheduler tests blocks on a caller-held deferred, so a
 * fixed depth cannot carry the chain past an operation the test has not
 * released yet.
 */
async function flushLifecycleTurns(): Promise<void> {
    for (let turn = 0; turn < 10; turn += 1) {
        await Promise.resolve();
    }
}

vi.mock('../../../repositories/pluginBridge/loadPlugin', () => ({
    loadPlugin: mocks.loadPluginRepo,
}));

vi.mock('../../../repositories/pluginBridge/unloadPlugin', () => ({
    unloadPlugin: mocks.unloadPluginRepo,
}));

vi.mock('../../../repositories/pluginBridge/openPluginGui', () => ({
    openPluginGui: mocks.openPluginGuiRepo,
}));

describe('Plugin Lifecycle Use Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        loadedExternalInstances.clear();
        mocks.loadPluginRepo.mockResolvedValue(pluginInstance);
        mocks.unloadPluginRepo.mockImplementation((instanceId?: string) =>
            Promise.resolve({ unloadedInstanceIds: instanceId ? [instanceId] : [], errors: [], reports: [] })
        );
    });

    it('loadPlugin delegates to repository', async () => {
        await loadPlugin('p1', 'inst1', 44_100);
        expect(mocks.loadPluginRepo).toHaveBeenCalledWith('p1', 'inst1', 44_100);
    });

    it('rejects mismatched keyed unload ownership', async () => {
        loadedExternalInstances.add('inst1');
        mocks.unloadPluginRepo.mockResolvedValueOnce({ unloadedInstanceIds: ['other'], errors: [], reports: [] });
        await expect(unloadPlugin('inst1')).rejects.toThrow('Invalid keyed unload_plugin response');
        expect([...loadedExternalInstances]).toEqual(['inst1']);
    });

    it('reconciles partial native bulk unload before rejecting', async () => {
        loadedExternalInstances.add('removed');
        loadedExternalInstances.add('survivor');
        mocks.unloadPluginRepo.mockResolvedValueOnce({
            unloadedInstanceIds: ['removed'],
            errors: ['survivor failed'],
            reports: [],
        });
        await expect(unloadPlugin()).rejects.toThrow('survivor failed');
        expect([...loadedExternalInstances]).toEqual(['survivor']);
    });
    it('serializes unload then load for the same instance', async () => {
        const unloaded = { unloadedInstanceIds: ['ordered-instance'], errors: [], reports: [] };
        const unloading = Promise.withResolvers<typeof unloaded>();
        mocks.unloadPluginRepo.mockReturnValueOnce(unloading.promise);
        mocks.loadPluginRepo.mockResolvedValueOnce(pluginInstance);
        loadedExternalInstances.add('ordered-instance');

        const unloadResult = unloadPlugin('ordered-instance');
        const duplicateUnload = unloadPlugin('ordered-instance');
        const loadResult = loadPlugin('p1', 'ordered-instance', 44_100);
        await Promise.resolve();

        expect(mocks.unloadPluginRepo).toHaveBeenCalledWith('ordered-instance');
        expect(mocks.loadPluginRepo).not.toHaveBeenCalled();

        unloading.resolve(unloaded);
        await Promise.all([unloadResult, duplicateUnload, loadResult]);

        expect(mocks.unloadPluginRepo).toHaveBeenCalledTimes(1);
        expect(mocks.loadPluginRepo).toHaveBeenCalledWith('p1', 'ordered-instance', 44_100);
        expect(mocks.unloadPluginRepo.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.loadPluginRepo.mock.invocationCallOrder[0]!
        );
    });

    it('registers an idle tail before a same-instance operation can reenter', async () => {
        const order: string[] = [];
        let nestedResult: ReturnType<typeof loadPlugin> | undefined;
        mocks.unloadPluginRepo.mockImplementationOnce(() => {
            order.push('outer-start');
            nestedResult = loadPlugin('p1', 'reentrant-instance', 44_100);
            order.push('outer-return');
            return Promise.resolve({ unloadedInstanceIds: ['reentrant-instance'], errors: [], reports: [] });
        });
        mocks.loadPluginRepo.mockImplementationOnce(() => {
            order.push('nested-run');
            return Promise.resolve(pluginInstance);
        });
        loadedExternalInstances.add('reentrant-instance');

        const outerResult = unloadPlugin('reentrant-instance');
        await Promise.resolve();

        expect(order).toEqual(['outer-start', 'outer-return']);
        await expect(outerResult).resolves.toBeUndefined();
        if (!nestedResult) {
            throw new Error('Expected the outer operation to enqueue a nested load');
        }
        await expect(nestedResult).resolves.toBe(pluginInstance);
        expect(order).toEqual(['outer-start', 'outer-return', 'nested-run']);
    });

    it('allows a different instance to progress while an unload is pending and then fails', async () => {
        const unloading = Promise.withResolvers<never>();
        const failure = new Error('unload failed');
        mocks.unloadPluginRepo.mockReturnValueOnce(unloading.promise);
        mocks.loadPluginRepo.mockResolvedValueOnce(pluginInstance);
        loadedExternalInstances.add('blocked-instance');

        const unloadResult = unloadPlugin('blocked-instance');
        const loadResult = loadPlugin('p1', 'independent-instance', 44_100);
        await Promise.resolve();

        expect(mocks.loadPluginRepo).toHaveBeenCalledWith('p1', 'independent-instance', 44_100);

        unloading.reject(failure);
        await expect(unloadResult).rejects.toBe(failure);
        expect(loadedExternalInstances.has('blocked-instance')).toBe(true);
        await expect(loadResult).resolves.toBe(pluginInstance);
    });

    it('runs queued same-instance work after a failure instead of inheriting it', async () => {
        const unloading = Promise.withResolvers<never>();
        const failure = new Error('unload failed');
        mocks.unloadPluginRepo.mockReturnValueOnce(unloading.promise);
        mocks.loadPluginRepo.mockResolvedValueOnce(pluginInstance);
        loadedExternalInstances.add('recovering-instance');

        const failedUnload = unloadPlugin('recovering-instance');
        const queuedLoad = loadPlugin('p1', 'recovering-instance', 44_100);

        expect(mocks.loadPluginRepo).not.toHaveBeenCalled();
        unloading.reject(failure);
        await expect(failedUnload).rejects.toBe(failure);
        await expect(queuedLoad).resolves.toBe(pluginInstance);
        expect(mocks.loadPluginRepo).toHaveBeenCalledWith('p1', 'recovering-instance', 44_100);
    });

    it('exposes only the ignored caller branch as an unhandled rejection', () => {
        const moduleUrl = pathToFileURL(
            resolve('src/modules/PluginHost/useCases/pluginLifecycle/serializePluginLifecycle.ts')
        ).href;
        const script = `
            import { serializePluginLifecycle } from ${JSON.stringify(moduleUrl)};

            const observed = [];
            process.on('unhandledRejection', (reason, promise) => {
                observed.push({ reason, promise });
            });

            const ignoredFailure = new Error('ignored caller failure');
            const ignoredResult = serializePluginLifecycle('ignored-instance', () =>
                Promise.reject(ignoredFailure)
            );
            await new Promise((resolve) => setImmediate(resolve));

            const caughtFailure = new Error('caught caller failure');
            const caughtResult = serializePluginLifecycle('caught-instance', () =>
                Promise.reject(caughtFailure)
            );
            await caughtResult.catch(() => undefined);
            await new Promise((resolve) => setImmediate(resolve));

            console.log(JSON.stringify({
                count: observed.length,
                ignoredCallerWasReported:
                    observed[0]?.reason === ignoredFailure && observed[0]?.promise === ignoredResult,
            }));
        `;

        const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
            encoding: 'utf8',
        });

        expect(JSON.parse(output)).toEqual({
            count: 1,
            ignoredCallerWasReported: true,
        });
    });

    it('openPluginGui delegates to repository', async () => {
        await openPluginGui('inst1');
        expect(mocks.openPluginGuiRepo).toHaveBeenCalledWith('inst1');
    });
});

describe('pluginLifecycleScheduler', () => {
    it('runs a queued operation after the prior rejects and returns its own outcome', async () => {
        const prior = Promise.withResolvers<never>();
        const priorFailure = new Error('prior operation failed');
        const first = pluginLifecycleScheduler.schedule('queued-after-rejection', () => prior.promise);
        const second = pluginLifecycleScheduler.schedule('queued-after-rejection', () =>
            Promise.resolve('successor-ran')
        );

        prior.reject(priorFailure);

        await expect(first).rejects.toBe(priorFailure);
        await expect(second).resolves.toBe('successor-ran');
    });

    it('hands a queued operation its own rejection, not the prior failure', async () => {
        const prior = Promise.withResolvers<never>();
        const priorFailure = new Error('prior operation failed');
        const successorFailure = new Error('successor operation failed');
        const first = pluginLifecycleScheduler.schedule('successor-rejection', () => prior.promise);
        const second = pluginLifecycleScheduler.schedule('successor-rejection', () => Promise.reject(successorFailure));

        prior.reject(priorFailure);

        await expect(first).rejects.toBe(priorFailure);
        await expect(second).rejects.toBe(successorFailure);
    });

    it('wraps a queued operation that throws a non-Error value synchronously', async () => {
        const prior = Promise.withResolvers<never>();
        const priorFailure = new Error('prior operation failed');
        const thrownValue = 'thrown without an Error wrapper';
        const first = pluginLifecycleScheduler.schedule('queued-sync-throw', () => prior.promise);
        const second = pluginLifecycleScheduler.schedule('queued-sync-throw', (): Promise<never> => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- intentionally throws a non-Error value to pin the scheduler's sync-throw normalization
            throw thrownValue;
        });

        prior.reject(priorFailure);
        await expect(first).rejects.toBe(priorFailure);

        const secondFailure = await second.catch((error: unknown) => error);
        if (!(secondFailure instanceof Error)) {
            throw new Error('Expected the queued sync throw to reject as a wrapped Error');
        }
        expect(secondFailure.message).toBe('Plugin lifecycle operation failed');
        expect(secondFailure.cause).toBe(thrownValue);
    });

    it('keeps a mixed fulfilled-and-rejected chain serial', async () => {
        const order: string[] = [];
        const firstTurn = Promise.withResolvers<void>();
        const secondTurn = Promise.withResolvers<never>();
        const secondFailure = new Error('middle operation failed');
        const first = pluginLifecycleScheduler.schedule('mixed-chain', async () => {
            order.push('first-start');
            await firstTurn.promise;
            order.push('first-end');
        });
        const second = pluginLifecycleScheduler.schedule('mixed-chain', () => {
            order.push('second-start');
            return secondTurn.promise;
        });
        const third = pluginLifecycleScheduler.schedule('mixed-chain', async () => {
            order.push('third-start');
            order.push('third-end');
        });

        await flushLifecycleTurns();
        expect(order).toEqual(['first-start']);

        firstTurn.resolve(undefined);
        await flushLifecycleTurns();
        expect(order).toEqual(['first-start', 'first-end', 'second-start']);

        secondTurn.reject(secondFailure);
        await expect(first).resolves.toBeUndefined();
        await expect(second).rejects.toBe(secondFailure);
        await expect(third).resolves.toBeUndefined();
        expect(order).toEqual(['first-start', 'first-end', 'second-start', 'third-start', 'third-end']);
    });

    it('drains the instance tail once queued work settles', async () => {
        const prior = Promise.withResolvers<never>();
        const priorFailure = new Error('prior operation failed');
        const first = pluginLifecycleScheduler.schedule('tail-drain', () => prior.promise);
        const second = pluginLifecycleScheduler.schedule('tail-drain', () => Promise.resolve('queued-ran'));

        prior.reject(priorFailure);
        await expect(first).rejects.toBe(priorFailure);
        await expect(second).resolves.toBe('queued-ran');

        let laterStarted = false;
        const later = pluginLifecycleScheduler.schedule('tail-drain', () => {
            laterStarted = true;
            return Promise.resolve('later-ran');
        });
        await Promise.resolve();

        expect(laterStarted).toBe(true);
        await expect(later).resolves.toBe('later-ran');
    });

    it('keeps gating new schedules behind the rebuild fence and waits out both outcomes', async () => {
        const existing = Promise.withResolvers<never>();
        const existingFailure = new Error('existing operation failed');
        const started: string[] = [];
        const failing = pluginLifecycleScheduler.schedule('fenced-instance', () => {
            started.push('failing');
            return existing.promise;
        });
        const succeeding = pluginLifecycleScheduler.schedule('fenced-instance', () => {
            started.push('succeeding');
            return Promise.resolve('succeeding-ran');
        });
        await flushLifecycleTurns();
        expect(started).toEqual(['failing']);

        const rebuild = pluginLifecycleScheduler.beginRebuild();
        expect(pluginLifecycleScheduler.currentRebuildCompletion()).not.toBeNull();
        let admitted = false;
        const late = pluginLifecycleScheduler.schedule('fenced-instance', () => {
            admitted = true;
            return Promise.resolve('late-ran');
        });

        let drained = false;
        void rebuild.waitForExistingOperations().then(() => {
            drained = true;
        });
        await flushLifecycleTurns();
        expect(drained).toBe(false);

        existing.reject(existingFailure);
        await expect(failing).rejects.toBe(existingFailure);
        await expect(succeeding).resolves.toBe('succeeding-ran');
        await flushLifecycleTurns();
        expect(drained).toBe(true);
        expect(admitted).toBe(false);

        rebuild.end();
        expect(pluginLifecycleScheduler.currentRebuildCompletion()).toBeNull();
        await expect(late).resolves.toBe('late-ran');
        expect(admitted).toBe(true);
    });
});
