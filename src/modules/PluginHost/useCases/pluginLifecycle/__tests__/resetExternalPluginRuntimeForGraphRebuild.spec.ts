import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { bytesToBase64 } from '#/utils/base64';

import { type PluginInstance } from '../../../repositories/pluginBridge/types';
import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../../stores/externalPluginActivationStore';
import { externalPluginParameterStore } from '../../../stores/externalPluginParameterStore';
import { activateExternalPlugin } from '../activateExternalPlugin';
import { beginProjectSessionPluginRetirement } from '../beginProjectSessionPluginRetirement';
import { carriedExternalPluginStates } from '../carriedExternalPluginStates';
import { clearLoadedExternalPlugins } from '../clearLoadedExternalPlugins';
import { externalLatencyReporters } from '../externalLatencyReporters';
import { externalPluginActivationOutcomes, externalPluginActivationTasks } from '../externalPluginActivationTasks';
import { loadedExternalInstances } from '../loadedExternalInstances';
import { resetExternalPluginRuntimeForGraphRebuild } from '../resetExternalPluginRuntimeForGraphRebuild';
import { LIFECYCLE_SETTLEMENT_DEADLINE_MS } from '../serializePluginLifecycle';
import { unloadPlugin } from '../unloadPlugin';
import { unloadPluginCarryingLiveState } from '../unloadPluginCarryingLiveState';

import type { unloadPlugin as unloadPluginRepoSignature } from '../../../repositories/pluginBridge/unloadPlugin';

const mocks = vi.hoisted(() => ({
    loadPlugin: vi.fn(),
    unloadPlugin: vi.fn<typeof unloadPluginRepoSignature>(),
    getPluginState: vi.fn<(instanceId: string) => Promise<Uint8Array>>(),
    notifyUser: vi.fn<(message: string, level?: string) => void>(),
}));

/** The repository's own reply shape, for tests settling a deferred unload by hand. */
type UnloadReply = Awaited<ReturnType<typeof unloadPluginRepoSignature>>;

vi.mock('../../../repositories/pluginBridge/loadPlugin', () => ({ loadPlugin: mocks.loadPlugin }));
vi.mock('../../../repositories/pluginBridge/unloadPlugin', () => ({ unloadPlugin: mocks.unloadPlugin }));
vi.mock('../../../repositories/pluginBridge/getPluginState', () => ({ getPluginState: mocks.getPluginState }));
vi.mock('../../../repositories/pluginBridge/onPluginLatencyChanged', () => ({
    onPluginLatencyChanged: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

const EMPTY_UNLOAD_REPLY: UnloadReply = { unloadedInstanceIds: [], errors: [], reports: [] };

/**
 * Leave `instanceId`'s keyed unload pending for the whole case — the IPC of a
 * plugin hung inside its own native call never answers — and hold the bulk
 * unload that follows until the case releases it.
 */
function hangKeyedUnload(instanceId: string): { releaseBulkUnload: () => void } {
    const hungUnload = Promise.withResolvers<UnloadReply>();
    const bulkUnload = Promise.withResolvers<UnloadReply>();
    // Answer at last once the case is over, so a wedged turn cannot leak into later cases.
    onTestFinished(() => {
        hungUnload.resolve({ unloadedInstanceIds: [instanceId], errors: [], reports: [] });
        bulkUnload.resolve(EMPTY_UNLOAD_REPLY);
    });
    mocks.unloadPlugin.mockImplementation((requested?: string) => {
        if (requested === instanceId) {
            return hungUnload.promise;
        }
        if (requested === undefined) {
            return bulkUnload.promise;
        }
        return Promise.resolve(EMPTY_UNLOAD_REPLY);
    });
    return { releaseBulkUnload: () => bulkUnload.resolve(EMPTY_UNLOAD_REPLY) };
}

const LATE_INSTANCE_ID = 'plugin-instance-1';

/** A load reply for `LATE_INSTANCE_ID`; `engine_plugin_id: null` is a load no engine has taken yet. */
function lateInstanceLoad(enginePluginId: number | null): PluginInstance {
    return {
        instance_id: LATE_INSTANCE_ID,
        plugin_id: 'hung-compressor',
        name: 'Hung Compressor',
        parameters: [],
        is_active: true,
        latency_samples: 0,
        latency_ms: 0,
        tail_samples: 0,
        engine_plugin_id: enginePluginId,
    };
}

/**
 * Load `LATE_INSTANCE_ID` attached to a running engine, start its carrying
 * unload with the native call held, and answer the held call by hand. The bulk
 * unload a fence runs answers at once.
 */
async function holdCarryingUnloadOfLoadedInstance(): Promise<{
    unload: Promise<void>;
    held: PromiseWithResolvers<UnloadReply>;
}> {
    mocks.loadPlugin.mockResolvedValue(lateInstanceLoad(1000));
    await activateExternalPlugin({ pluginId: 'hung-compressor', instanceId: LATE_INSTANCE_ID });
    mocks.getPluginState.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const held = Promise.withResolvers<UnloadReply>();
    onTestFinished(() => {
        held.resolve(EMPTY_UNLOAD_REPLY);
    });
    mocks.unloadPlugin.mockImplementation((requested?: string) =>
        requested === LATE_INSTANCE_ID ? held.promise : Promise.resolve(EMPTY_UNLOAD_REPLY)
    );
    const unload = unloadPluginCarryingLiveState(LATE_INSTANCE_ID);
    await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith(LATE_INSTANCE_ID));
    return { unload, held };
}

describe('resetExternalPluginRuntimeForGraphRebuild', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearLoadedExternalPlugins();
        carriedExternalPluginStates.clear();
        externalPluginActivationStore.set(defaultExternalPluginActivationState);
        mocks.getPluginState.mockResolvedValue(new Uint8Array());
        mocks.loadPlugin.mockResolvedValue({
            instance_id: 'plugin-instance-1',
            parameters: [],
            latency_samples: 0,
            latency_ms: 4,
            engine_plugin_id: 1000,
        });
        mocks.unloadPlugin.mockResolvedValue({ unloadedInstanceIds: ['plugin-instance-1'], errors: [], reports: [] });
    });

    it('invalidates the full lifecycle generation so an already-loaded plugin is reattached', async () => {
        const latencyReporter = vi.fn();
        await expect(
            activateExternalPlugin({
                pluginId: 'compressor',
                instanceId: 'plugin-instance-1',
                onLatencyMs: latencyReporter,
            })
        ).resolves.toEqual({ status: 'active' });

        expect(loadedExternalInstances.has('plugin-instance-1')).toBe(true);
        expect(externalPluginActivationOutcomes.has('plugin-instance-1')).toBe(true);
        expect(externalLatencyReporters.has('plugin-instance-1')).toBe(true);

        await resetExternalPluginRuntimeForGraphRebuild();

        expect(loadedExternalInstances.size).toBe(0);
        expect(externalPluginActivationTasks.size).toBe(0);
        expect(externalPluginActivationOutcomes.size).toBe(0);
        expect(externalLatencyReporters.size).toBe(0);
        expect(externalPluginActivationStore.value).toEqual(defaultExternalPluginActivationState);

        await expect(
            activateExternalPlugin({
                pluginId: 'compressor',
                instanceId: 'plugin-instance-1',
            })
        ).resolves.toEqual({ status: 'active' });
        expect(mocks.unloadPlugin).toHaveBeenCalledOnce();
        expect(mocks.loadPlugin).toHaveBeenCalledTimes(2);
    });

    it('fences activation admitted during rebuild until bulk unload has completed', async () => {
        // Derived from the production load result rather than restated, so a
        // field the host starts returning — `parameters` was the last one —
        // cannot leave this fixture describing a shape nothing produces.
        const firstLoad =
            Promise.withResolvers<
                Pick<
                    PluginInstance,
                    'instance_id' | 'parameters' | 'latency_samples' | 'latency_ms' | 'engine_plugin_id'
                >
            >();
        const bulkUnload = Promise.withResolvers<UnloadReply>();
        mocks.loadPlugin.mockReturnValueOnce(firstLoad.promise).mockResolvedValueOnce({
            instance_id: 'late-instance',
            parameters: [],
            latency_samples: 0,
            latency_ms: 2,
            engine_plugin_id: 1001,
        });
        mocks.unloadPlugin.mockReturnValueOnce(bulkUnload.promise);

        const firstActivation = activateExternalPlugin({
            pluginId: 'compressor',
            instanceId: 'plugin-instance-1',
        });
        await vi.waitFor(() => expect(mocks.loadPlugin).toHaveBeenCalledOnce());
        const reset = resetExternalPluginRuntimeForGraphRebuild();
        const lateActivation = activateExternalPlugin({
            pluginId: 'compressor',
            instanceId: 'late-instance',
        });

        firstLoad.resolve({
            instance_id: 'plugin-instance-1',
            parameters: [],
            latency_samples: 0,
            latency_ms: 4,
            engine_plugin_id: 1000,
        });
        await firstActivation;
        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledOnce());
        bulkUnload.resolve({ unloadedInstanceIds: ['plugin-instance-1'], errors: [], reports: [] });
        await Promise.all([reset, lateActivation]);

        expect(mocks.unloadPlugin.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.loadPlugin.mock.invocationCallOrder[1]!
        );
        expect(loadedExternalInstances.has('late-instance')).toBe(true);
    });

    it('keeps activation admission fenced through project-session bulk retirement until the reused host reopens', async () => {
        const bulkUnload = Promise.withResolvers<UnloadReply>();
        mocks.unloadPlugin.mockReturnValueOnce(bulkUnload.promise);
        mocks.loadPlugin.mockResolvedValueOnce({
            instance_id: 'late-instance',
            parameters: [],
            latency_samples: 0,
            latency_ms: 2,
            engine_plugin_id: 1001,
        });
        const retirement = await beginProjectSessionPluginRetirement();
        const retiring = retirement.retire();
        const activation = activateExternalPlugin({
            pluginId: 'compressor',
            instanceId: 'late-instance',
        });

        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledOnce());
        expect(mocks.loadPlugin).not.toHaveBeenCalled();
        bulkUnload.resolve({ unloadedInstanceIds: [], errors: [], reports: [] });
        await retiring;
        expect(mocks.loadPlugin).not.toHaveBeenCalled();

        retirement.reopen();
        await activation;
        expect(mocks.loadPlugin).toHaveBeenCalledOnce();
    });

    it('keeps project-session activation fenced when native bulk retirement rejects', async () => {
        mocks.unloadPlugin.mockRejectedValueOnce(new Error('native unload failed'));
        const retirement = await beginProjectSessionPluginRetirement();

        await expect(retirement.retire()).rejects.toThrow('native unload failed');
        const activation = activateExternalPlugin({
            pluginId: 'compressor',
            instanceId: 'after-failed-retirement',
        });
        await Promise.resolve();
        expect(mocks.loadPlugin).not.toHaveBeenCalled();

        retirement.reopen();
        await activation;
        expect(mocks.loadPlugin).toHaveBeenCalledOnce();
    });

    it('waits for a pre-admitted activation before bulk retirement and leaves no late instance behind', async () => {
        const admittedLoad =
            Promise.withResolvers<
                Pick<
                    PluginInstance,
                    'instance_id' | 'parameters' | 'latency_samples' | 'latency_ms' | 'engine_plugin_id'
                >
            >();
        const bulkUnload = Promise.withResolvers<UnloadReply>();
        mocks.loadPlugin.mockReturnValueOnce(admittedLoad.promise);
        mocks.unloadPlugin.mockReturnValueOnce(bulkUnload.promise);

        const activation = activateExternalPlugin({
            pluginId: 'compressor',
            instanceId: 'pre-admitted-instance',
        });
        await vi.waitFor(() => expect(mocks.loadPlugin).toHaveBeenCalledOnce());

        const retirement = await beginProjectSessionPluginRetirement();
        const retiring = retirement.retire();
        await Promise.resolve();
        expect(mocks.unloadPlugin).not.toHaveBeenCalled();

        admittedLoad.resolve({
            instance_id: 'pre-admitted-instance',
            parameters: [],
            latency_samples: 0,
            latency_ms: 3,
            engine_plugin_id: 1002,
        });
        await expect(activation).resolves.toMatchObject({ status: 'failed', stage: 'attach' });
        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledOnce());
        bulkUnload.resolve({ unloadedInstanceIds: ['pre-admitted-instance'], errors: [], reports: [] });
        await retiring;

        expect(loadedExternalInstances.has('pre-admitted-instance')).toBe(false);
        expect(externalPluginActivationTasks.has('pre-admitted-instance')).toBe(false);
        expect(externalPluginActivationOutcomes.has('pre-admitted-instance')).toBe(false);
        retirement.reopen();
    });

    it('waits for an already-active rebuild before acquiring the project-session retirement fence', async () => {
        const activeUnload = Promise.withResolvers<UnloadReply>();
        mocks.unloadPlugin.mockReturnValueOnce(activeUnload.promise);
        const activeRebuild = resetExternalPluginRuntimeForGraphRebuild();
        const retirement = beginProjectSessionPluginRetirement();

        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledOnce());
        let retirementAcquired = false;
        void retirement.then(() => {
            retirementAcquired = true;
        });
        await Promise.resolve();
        expect(retirementAcquired).toBe(false);
        // The session fence cannot begin its own bulk unload while the active
        // graph rebuild still owns the lifecycle fence.
        expect(mocks.unloadPlugin).toHaveBeenCalledOnce();

        activeUnload.resolve({ unloadedInstanceIds: [], errors: [], reports: [] });
        await activeRebuild;
        const sessionRetirement = await retirement;
        await sessionRetirement.retire();
        sessionRetirement.reopen();

        expect(mocks.unloadPlugin).toHaveBeenCalledTimes(2);
    });

    it('stops waiting on a lifecycle call that never answers, fails that plugin by name, and admits later activations', async () => {
        await activateExternalPlugin({ pluginId: 'hung-compressor', instanceId: 'plugin-instance-1' });
        const { releaseBulkUnload } = hangKeyedUnload('plugin-instance-1');
        void unloadPlugin('plugin-instance-1');
        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith('plugin-instance-1'));

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        onTestFinished(() => {
            vi.useRealTimers();
        });
        const reset = resetExternalPluginRuntimeForGraphRebuild();
        await vi.advanceTimersByTimeAsync(LIFECYCLE_SETTLEMENT_DEADLINE_MS);
        vi.useRealTimers();

        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith(undefined));
        expect(externalPluginActivationStore.value?.byInstanceId['plugin-instance-1']).toEqual({
            status: 'error',
            message: expect.stringContaining('hung-compressor'),
        });
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('hung-compressor'), 'error');
        releaseBulkUnload();
        await reset;

        mocks.loadPlugin.mockResolvedValue({
            instance_id: 'any',
            parameters: [],
            latency_samples: 0,
            latency_ms: 0,
            engine_plugin_id: 1003,
        });
        await expect(activateExternalPlugin({ pluginId: 'equalizer', instanceId: 'other-instance' })).resolves.toEqual({
            status: 'active',
        });
        // The hung call keeps no lifecycle turn: the instance it hung on comes
        // back as a fresh load rather than queueing behind a call that cannot answer.
        await expect(
            activateExternalPlugin({ pluginId: 'hung-compressor', instanceId: 'plugin-instance-1' })
        ).resolves.toEqual({ status: 'active' });
    });

    it('keeps a keyed unload scheduled during the fence, so a reactivation still waits for it', async () => {
        await activateExternalPlugin({ pluginId: 'hung-compressor', instanceId: 'plugin-instance-1' });
        const hungUnload = Promise.withResolvers<UnloadReply>();
        const bulkUnload = Promise.withResolvers<UnloadReply>();
        onTestFinished(() => {
            hungUnload.resolve({ unloadedInstanceIds: ['plugin-instance-1'], errors: [], reports: [] });
            bulkUnload.resolve(EMPTY_UNLOAD_REPLY);
        });
        let keyedUnloadsOfInstance = 0;
        mocks.unloadPlugin.mockImplementation((requested?: string) => {
            if (requested === undefined) {
                return bulkUnload.promise;
            }
            keyedUnloadsOfInstance += 1;
            if (keyedUnloadsOfInstance === 1) {
                return hungUnload.promise;
            }
            return Promise.resolve({ unloadedInstanceIds: [requested], errors: [], reports: [] });
        });
        void unloadPlugin('plugin-instance-1');
        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith('plugin-instance-1'));

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        onTestFinished(() => {
            vi.useRealTimers();
        });
        const reset = resetExternalPluginRuntimeForGraphRebuild();
        // Scheduled while the fence stands: it waits for the fence, and it is
        // not the call the fence is about to give up on.
        void unloadPlugin('plugin-instance-1');
        await vi.advanceTimersByTimeAsync(LIFECYCLE_SETTLEMENT_DEADLINE_MS);
        vi.useRealTimers();
        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith(undefined));

        // Issued inside the fence too, so it is admitted right behind that
        // unload; it must wait for the unload rather than load into its path.
        const reactivation = activateExternalPlugin({ pluginId: 'hung-compressor', instanceId: 'plugin-instance-1' });
        bulkUnload.resolve(EMPTY_UNLOAD_REPLY);
        await reset;

        await expect(reactivation).resolves.toEqual({ status: 'active' });
        expect(keyedUnloadsOfInstance).toBe(1);
        expect(loadedExternalInstances.has('plugin-instance-1')).toBe(true);
    });

    it('ends a project-session retirement behind a lifecycle call that never answers', async () => {
        await activateExternalPlugin({ pluginId: 'hung-compressor', instanceId: 'plugin-instance-1' });
        const { releaseBulkUnload } = hangKeyedUnload('plugin-instance-1');
        void unloadPlugin('plugin-instance-1');
        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith('plugin-instance-1'));

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        onTestFinished(() => {
            vi.useRealTimers();
        });
        const retirement = await beginProjectSessionPluginRetirement();
        const retiring = retirement.retire();
        await vi.advanceTimersByTimeAsync(LIFECYCLE_SETTLEMENT_DEADLINE_MS);
        vi.useRealTimers();

        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith(undefined));
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('hung-compressor'), 'error');
        releaseBulkUnload();
        await retiring;
        retirement.release();
    });

    it('waits out an operation that settles inside the deadline and fails nothing', async () => {
        loadedExternalInstances.add('plugin-instance-1');
        const keyedUnload = Promise.withResolvers<UnloadReply>();
        mocks.unloadPlugin.mockImplementation((requested?: string) =>
            requested === undefined ? Promise.resolve(EMPTY_UNLOAD_REPLY) : keyedUnload.promise
        );
        void unloadPlugin('plugin-instance-1');
        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith('plugin-instance-1'));

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        onTestFinished(() => {
            vi.useRealTimers();
        });
        const reset = resetExternalPluginRuntimeForGraphRebuild();
        await vi.advanceTimersByTimeAsync(LIFECYCLE_SETTLEMENT_DEADLINE_MS - 1);
        expect(mocks.unloadPlugin).not.toHaveBeenCalledWith(undefined);
        vi.useRealTimers();
        keyedUnload.resolve({ unloadedInstanceIds: ['plugin-instance-1'], errors: [], reports: [] });
        await reset;

        expect(mocks.unloadPlugin).toHaveBeenCalledWith(undefined);
        expect(mocks.notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'error');
    });

    it('serializes bulk unload after an already admitted keyed lifecycle operation', async () => {
        loadedExternalInstances.add('plugin-instance-1');
        const keyedUnload = Promise.withResolvers<UnloadReply>();
        const bulkUnload = Promise.withResolvers<UnloadReply>();
        let keyedUnloadSettled = false;
        let bulkObservedSettledKeyedUnload = false;
        void keyedUnload.promise.then(() => {
            keyedUnloadSettled = true;
        });
        mocks.unloadPlugin.mockImplementation((instanceId?: string) => {
            if (instanceId) {
                return keyedUnload.promise;
            }
            bulkObservedSettledKeyedUnload = keyedUnloadSettled;
            return bulkUnload.promise;
        });

        const keyed = unloadPlugin('plugin-instance-1');
        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith('plugin-instance-1'));
        const reset = resetExternalPluginRuntimeForGraphRebuild();
        keyedUnload.resolve({ unloadedInstanceIds: ['plugin-instance-1'], errors: [], reports: [] });
        await keyed;
        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith(undefined));
        bulkUnload.resolve({ unloadedInstanceIds: [], errors: [], reports: [] });
        await reset;

        expect(bulkObservedSettledKeyedUnload).toBe(true);
    });

    describe('a late answer to an unload a fence let go of', () => {
        async function letGoThroughGraphRebuild(): Promise<void> {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            onTestFinished(() => {
                vi.useRealTimers();
            });
            const reset = resetExternalPluginRuntimeForGraphRebuild();
            await vi.advanceTimersByTimeAsync(LIFECYCLE_SETTLEMENT_DEADLINE_MS);
            vi.useRealTimers();
            await reset;
        }

        async function reactivate(enginePluginId: number | null): Promise<void> {
            mocks.loadPlugin.mockResolvedValue(lateInstanceLoad(enginePluginId));
            await activateExternalPlugin({ pluginId: 'hung-compressor', instanceId: LATE_INSTANCE_ID });
            expect(mocks.loadPlugin).toHaveBeenCalledTimes(2);
        }

        function expectReactivatedInstanceKept(activationStatus: unknown): void {
            expect(loadedExternalInstances.has(LATE_INSTANCE_ID)).toBe(true);
            expect(externalPluginParameterStore.value?.byInstanceId[LATE_INSTANCE_ID]?.engineAttached).toBe(true);
            expect(externalPluginActivationStore.value?.byInstanceId[LATE_INSTANCE_ID]).toEqual(activationStatus);
            // The old generation's read must not wait for the next activation as a carry.
            expect(carriedExternalPluginStates.has(LATE_INSTANCE_ID)).toBe(false);
        }

        it('does not forget the instance a graph rebuild reactivated, nor carry the old read onto it', async () => {
            const { unload, held } = await holdCarryingUnloadOfLoadedInstance();
            await letGoThroughGraphRebuild();
            await reactivate(1001);
            const activationStatus = externalPluginActivationStore.value?.byInstanceId[LATE_INSTANCE_ID];
            expect(activationStatus).toEqual({ status: 'active' });

            held.resolve({ unloadedInstanceIds: [LATE_INSTANCE_ID], errors: [], reports: [] });
            await unload;

            expectReactivatedInstanceKept(activationStatus);
        });

        it('hands the removal read to the next activation when it succeeds before any reactivation', async () => {
            const { unload, held } = await holdCarryingUnloadOfLoadedInstance();
            await letGoThroughGraphRebuild();
            // The rebuild's own read finds the hung instance unreadable-empty, so only the removal's read exists.
            carriedExternalPluginStates.clear();

            held.resolve({ unloadedInstanceIds: [LATE_INSTANCE_ID], errors: [], reports: [] });
            await unload;

            expect(carriedExternalPluginStates.get(LATE_INSTANCE_ID)).toEqual({
                pluginId: 'hung-compressor',
                stateChunk: bytesToBase64(new Uint8Array([1, 2, 3])),
            });
        });

        it('rejects a late answer that carries native errors and leaves the reactivated instance untouched', async () => {
            const { unload, held } = await holdCarryingUnloadOfLoadedInstance();
            await letGoThroughGraphRebuild();
            await reactivate(1001);
            const activationStatus = externalPluginActivationStore.value?.byInstanceId[LATE_INSTANCE_ID];

            held.resolve({ unloadedInstanceIds: [], errors: ['plugin refused to unload'], reports: [] });
            await expect(unload).rejects.toThrow('plugin refused to unload');

            expectReactivatedInstanceKept(activationStatus);
        });

        it('keeps no removal carry when the late answer is a refusal', async () => {
            const { unload, held } = await holdCarryingUnloadOfLoadedInstance();
            await letGoThroughGraphRebuild();
            carriedExternalPluginStates.clear();

            held.resolve({ unloadedInstanceIds: [], errors: ['plugin refused to unload'], reports: [] });
            await expect(unload).rejects.toThrow('plugin refused to unload');

            expect(carriedExternalPluginStates.has(LATE_INSTANCE_ID)).toBe(false);
        });

        it('does not restore the old attachment onto the reactivated instance when it rejects', async () => {
            const { unload, held } = await holdCarryingUnloadOfLoadedInstance();
            await letGoThroughGraphRebuild();
            // No engine has taken the reactivated instance yet, so it is loaded detached.
            await reactivate(null);
            expect(externalPluginParameterStore.value?.byInstanceId[LATE_INSTANCE_ID]?.engineAttached).toBe(false);

            held.reject(new Error('late native unload failure'));
            await expect(unload).rejects.toThrow('late native unload failure');

            expect(loadedExternalInstances.has(LATE_INSTANCE_ID)).toBe(true);
            expect(externalPluginParameterStore.value?.byInstanceId[LATE_INSTANCE_ID]?.engineAttached).toBe(false);
        });

        it('does not run a keyed unload queued behind the hung one onto the reactivated instance', async () => {
            const { unload, held } = await holdCarryingUnloadOfLoadedInstance();
            // Admitted before the fence too (Remove, Undo, Remove), queued on the hung call's turn.
            const queuedUnload = unloadPlugin(LATE_INSTANCE_ID);
            await letGoThroughGraphRebuild();
            await reactivate(1001);
            const activationStatus = externalPluginActivationStore.value?.byInstanceId[LATE_INSTANCE_ID];
            mocks.unloadPlugin.mockImplementation((requested?: string) =>
                Promise.resolve({
                    unloadedInstanceIds: requested === undefined ? [] : [requested],
                    errors: [],
                    reports: [],
                })
            );

            held.resolve({ unloadedInstanceIds: [LATE_INSTANCE_ID], errors: [], reports: [] });
            await unload;
            await queuedUnload;

            expect(mocks.unloadPlugin.mock.calls.filter(([requested]) => requested === LATE_INSTANCE_ID)).toHaveLength(
                1
            );
            expectReactivatedInstanceKept(activationStatus);
        });

        it('does not forget the instance a cancelled session retirement reactivated', async () => {
            const { unload, held } = await holdCarryingUnloadOfLoadedInstance();
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            onTestFinished(() => {
                vi.useRealTimers();
            });
            const retirement = await beginProjectSessionPluginRetirement();
            const retiring = retirement.retire();
            await vi.advanceTimersByTimeAsync(LIFECYCLE_SETTLEMENT_DEADLINE_MS);
            vi.useRealTimers();
            await retiring;
            // Cancelled: the carries stay for the rebuild that reactivates the instance.
            retirement.reopen();
            await reactivate(1001);
            const activationStatus = externalPluginActivationStore.value?.byInstanceId[LATE_INSTANCE_ID];
            expect(activationStatus).toEqual({ status: 'active' });

            held.resolve({ unloadedInstanceIds: [LATE_INSTANCE_ID], errors: [], reports: [] });
            await unload;

            expectReactivatedInstanceKept(activationStatus);
        });
    });
});
