import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { type PluginInstance } from '../../../repositories/pluginBridge/types';
import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../../stores/externalPluginActivationStore';
import { activateExternalPlugin } from '../activateExternalPlugin';
import { beginProjectSessionPluginRetirement } from '../beginProjectSessionPluginRetirement';
import { carriedExternalPluginStateFence, carriedExternalPluginStates } from '../carriedExternalPluginStates';
import { clearLoadedExternalPlugins } from '../clearLoadedExternalPlugins';
import { externalPluginRestoreFailures } from '../externalPluginRestoreFailures';
import { externalPluginServiceMessages } from '../externalPluginServiceMessages';
import { failUnresponsiveExternalPlugins } from '../failUnresponsiveExternalPlugins';
import { forgetRetiredPluginInstances } from '../forgetRetiredPluginInstances';
import { loadedExternalInstances } from '../loadedExternalInstances';
import { markExternalPluginEngineAttached } from '../markExternalPluginEngineAttached';
import { markExternalPluginRestoreFailure } from '../markExternalPluginRestoreFailure';
import { PENDING_UNLOAD_WAIT_TIMEOUT_MS } from '../pendingUnloadWaitTimeout';
import { pluginUnresponsiveMessage } from '../pluginUnresponsiveMessage';
import { projectSwitchLostPlugins } from '../projectSwitchLostPlugins';
import { readExternalPluginStatesBeforeEngineRetire } from '../readExternalPluginStatesBeforeEngineRetire';
import { resetExternalPluginRuntimeForGraphRebuild } from '../resetExternalPluginRuntimeForGraphRebuild';
import { restorePluginState } from '../restorePluginState';
import { settleProjectSwitchPluginTeardown } from '../settleProjectSwitchPluginTeardown';
import { unloadPlugin } from '../unloadPlugin';
import { unloadPluginCarryingLiveState } from '../unloadPluginCarryingLiveState';
import { unloadPluginsBeforeProjectSwitch } from '../unloadPluginsBeforeProjectSwitch';

import type { unloadPlugin as unloadPluginRepoSignature } from '../../../repositories/pluginBridge/unloadPlugin';

// The native host is doubled at the IPC repository boundary; every PluginHost
// use case between a teardown and the next activation is real. The double's
// live state ("live") differs from the project chunk ("saved"), so what the
// reactivation hands `setPluginState` says which one survived the teardown.
const mocks = vi.hoisted(() => ({
    loadPlugin: vi.fn<(pluginId: string, instanceId: string) => Promise<PluginInstance>>(),
    getPluginState: vi.fn<(instanceId: string) => Promise<Uint8Array>>(),
    setPluginState: vi.fn<(instanceId: string, state: Uint8Array) => Promise<void>>(),
    unloadPlugin: vi.fn<typeof unloadPluginRepoSignature>(),
    notifyUser: vi.fn<(message: string, level?: string) => void>(),
}));

vi.mock('../../../repositories/pluginBridge/loadPlugin', () => ({ loadPlugin: mocks.loadPlugin }));
vi.mock('../../../repositories/pluginBridge/getPluginState', () => ({ getPluginState: mocks.getPluginState }));
vi.mock('../../../repositories/pluginBridge/setPluginState', () => ({ setPluginState: mocks.setPluginState }));
vi.mock('../../../repositories/pluginBridge/unloadPlugin', () => ({ unloadPlugin: mocks.unloadPlugin }));
vi.mock('../../../repositories/pluginBridge/onPluginLatencyChanged', () => ({
    onPluginLatencyChanged: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: vi.fn() } }));

const INSTANCE_ID = 'inst-1';
const PLUGIN_ID = 'synth';
// base64 'c2F2ZWQ=' is "saved"; 'bGl2ZQ==' is "live".
const SAVED_CHUNK = 'c2F2ZWQ=';
const SAVED_BYTES = new Uint8Array([115, 97, 118, 101, 100]);
const LIVE_BYTES = new Uint8Array([108, 105, 118, 101]);
// "newer": live state the plugin reached after an earlier read.
const NEWER_LIVE_BYTES = new Uint8Array([110, 101, 119, 101, 114]);
const OTHER_INSTANCE_ID = 'inst-2';
// "live-2": the second instance's own live state, distinct from the first's.
const OTHER_LIVE_BYTES = new Uint8Array([108, 105, 118, 101, 45, 50]);

function pluginInstance(instanceId = INSTANCE_ID): PluginInstance {
    return {
        instance_id: instanceId,
        plugin_id: PLUGIN_ID,
        name: PLUGIN_ID,
        parameters: [],
        is_active: true,
        latency_samples: 0,
        latency_ms: 0,
        tail_samples: 0,
        tail_sequence: 0,
        engine_plugin_id: 1000,
    };
}

function activate(stateChunk: string | undefined, pluginId = PLUGIN_ID, instanceId = INSTANCE_ID) {
    return activateExternalPlugin({ pluginId, instanceId, stateChunk });
}

/** Load both instances with the project chunk; each reports its own live state. */
async function activateBothAndEdit(): Promise<void> {
    mocks.getPluginState.mockImplementation((instanceId) =>
        Promise.resolve(instanceId === INSTANCE_ID ? LIVE_BYTES : OTHER_LIVE_BYTES)
    );
    await expect(activate(SAVED_CHUNK)).resolves.toEqual({ status: 'active' });
    await expect(activate(SAVED_CHUNK, PLUGIN_ID, OTHER_INSTANCE_ID)).resolves.toEqual({ status: 'active' });
    mocks.setPluginState.mockClear();
}

/** Reactivate both instances and report what each was restored with. */
async function reactivateBoth(): Promise<unknown[]> {
    await activate(SAVED_CHUNK);
    await activate(SAVED_CHUNK, PLUGIN_ID, OTHER_INSTANCE_ID);
    return mocks.setPluginState.mock.calls;
}

/** Load once with the project chunk, then forget that restore so only the reactivation's is observed. */
async function activateAndEdit(stateChunk: string | undefined): Promise<void> {
    await expect(activate(stateChunk)).resolves.toEqual({ status: 'active' });
    mocks.setPluginState.mockClear();
}

function warnings(): string[] {
    return mocks.notifyUser.mock.calls.filter(([, level]) => level === 'warning').map(([message]) => message);
}

describe('live plugin state across an app-initiated teardown', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearLoadedExternalPlugins();
        carriedExternalPluginStates.clear();
        projectSwitchLostPlugins.clear();
        externalPluginActivationStore.set(defaultExternalPluginActivationState);
        mocks.loadPlugin.mockImplementation((_pluginId, instanceId) => Promise.resolve(pluginInstance(instanceId)));
        mocks.getPluginState.mockResolvedValue(LIVE_BYTES);
        mocks.setPluginState.mockResolvedValue(undefined);
        mocks.unloadPlugin.mockImplementation((instanceId) =>
            Promise.resolve({
                unloadedInstanceIds: instanceId === undefined ? [...loadedExternalInstances] : [instanceId],
                errors: [],
                reports: [],
            })
        );
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('device removal', () => {
        // Remove, Undo, Redo: the Redo's unload is admitted while the Undo's activation still waits.
        it('does not reload a waiting reactivation once a later unload of the instance is admitted', async () => {
            await activateAndEdit(SAVED_CHUNK);
            const nativeUnload = Promise.withResolvers<Awaited<ReturnType<typeof unloadPluginRepoSignature>>>();
            mocks.unloadPlugin.mockReturnValueOnce(nativeUnload.promise);

            const removal = unloadPluginCarryingLiveState(INSTANCE_ID);
            await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledOnce());
            const reactivation = activate(SAVED_CHUNK);
            const secondRemoval = unloadPluginCarryingLiveState(INSTANCE_ID);
            nativeUnload.resolve({ unloadedInstanceIds: [INSTANCE_ID], errors: [], reports: [] });
            await Promise.all([removal, secondRemoval]);

            await expect(reactivation).resolves.toMatchObject({ status: 'failed', stage: 'load' });
            expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(false);
            expect(mocks.loadPlugin).toHaveBeenCalledOnce();
        });

        // Remove and Undo while the instance's first load is still in flight: the removal's unload
        // queues behind that load, so the Undo must wait for the unload rather than join the load.
        it('reloads an instance whose removal and Undo both land while its first load is in flight', async () => {
            const nativeLoad = Promise.withResolvers<PluginInstance>();
            mocks.loadPlugin.mockReturnValueOnce(nativeLoad.promise);

            const firstActivation = activate(SAVED_CHUNK);
            const removal = unloadPluginCarryingLiveState(INSTANCE_ID);
            const reactivation = activate(SAVED_CHUNK);
            nativeLoad.resolve(pluginInstance());
            await Promise.all([firstActivation, removal]);

            await expect(reactivation).resolves.toEqual({ status: 'active' });
            expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(true);
            expect(mocks.loadPlugin).toHaveBeenCalledTimes(2);
        });

        // The removal's unload queues behind the first load, and that load's restore queues behind the
        // unload, so the restore reaches a native host that no longer holds the instance.
        it('writes no restore failure for an instance removed while its first load was in flight', async () => {
            const nativeLoad = Promise.withResolvers<PluginInstance>();
            mocks.loadPlugin.mockReturnValueOnce(nativeLoad.promise);
            mocks.setPluginState.mockImplementation((instanceId) => {
                if (loadedExternalInstances.has(instanceId)) {
                    return Promise.resolve();
                }
                return Promise.reject(new Error(`unknown plugin instance ${instanceId}`));
            });

            const firstActivation = activate(SAVED_CHUNK);
            const removal = unloadPluginCarryingLiveState(INSTANCE_ID);
            nativeLoad.resolve(pluginInstance());
            await removal;

            await expect(firstActivation).resolves.toMatchObject({ status: 'failed', stage: 'restore' });
            expect(mocks.setPluginState).toHaveBeenCalledOnce();
            expect(externalPluginRestoreFailures.has(INSTANCE_ID)).toBe(false);
            expect(externalPluginActivationStore.value?.byInstanceId[INSTANCE_ID]?.status).not.toBe('error');
        });

        // A rejected unload settles the wait too: the instance's fate is the unload's caller's to report.
        it('reactivates after a pending unload of the instance rejects', async () => {
            await activateAndEdit(SAVED_CHUNK);
            const nativeUnload = Promise.withResolvers<Awaited<ReturnType<typeof unloadPluginRepoSignature>>>();
            mocks.unloadPlugin.mockReturnValueOnce(nativeUnload.promise);

            const removal = unloadPluginCarryingLiveState(INSTANCE_ID);
            await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledOnce());
            const reactivation = activate(SAVED_CHUNK);
            nativeUnload.reject(new Error('native unload failed'));
            await expect(removal).rejects.toThrow('native unload failed');

            await expect(reactivation).resolves.toEqual({ status: 'active' });
            expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(true);
        });

        it('writes no restore failure for a restore retry the runtime clear overtook', async () => {
            mocks.setPluginState.mockRejectedValueOnce(new Error('chunk rejected'));
            await expect(activate(SAVED_CHUNK)).resolves.toMatchObject({ status: 'failed', stage: 'restore' });
            const retryWrite = Promise.withResolvers<void>();
            mocks.setPluginState.mockReturnValueOnce(retryWrite.promise);

            const retry = activate(SAVED_CHUNK);
            await vi.waitFor(() => expect(mocks.setPluginState).toHaveBeenCalledTimes(2));
            clearLoadedExternalPlugins();
            retryWrite.reject(new Error(`unknown plugin instance ${INSTANCE_ID}`));

            await expect(retry).resolves.toMatchObject({ status: 'failed', stage: 'restore' });
            expect(externalPluginRestoreFailures.has(INSTANCE_ID)).toBe(false);
            expect(externalPluginActivationStore.value?.byInstanceId[INSTANCE_ID]?.status).not.toBe('error');
        });

        it('answers superseded when the restore an earlier removal overtook resolves', async () => {
            const nativeLoad = Promise.withResolvers<PluginInstance>();
            mocks.loadPlugin.mockReturnValueOnce(nativeLoad.promise);

            const firstActivation = activate(SAVED_CHUNK);
            const removal = unloadPluginCarryingLiveState(INSTANCE_ID);
            nativeLoad.resolve(pluginInstance());
            await removal;

            await expect(firstActivation).resolves.toMatchObject({ status: 'failed', stage: 'restore' });
            expect(mocks.setPluginState).toHaveBeenCalledOnce();
        });

        it('answers superseded when a restore retry the runtime clear overtook resolves', async () => {
            mocks.setPluginState.mockRejectedValueOnce(new Error('chunk rejected'));
            await expect(activate(SAVED_CHUNK)).resolves.toMatchObject({ status: 'failed', stage: 'restore' });
            const retryWrite = Promise.withResolvers<void>();
            mocks.setPluginState.mockReturnValueOnce(retryWrite.promise);

            const retry = activate(SAVED_CHUNK);
            await vi.waitFor(() => expect(mocks.setPluginState).toHaveBeenCalledTimes(2));
            clearLoadedExternalPlugins();
            retryWrite.resolve();

            await expect(retry).resolves.toMatchObject({ status: 'failed', stage: 'restore' });
            expect(externalPluginActivationStore.value?.byInstanceId[INSTANCE_ID]?.status).not.toBe('active');
        });

        // An engine retire forgets the instance without ending the graph generation.
        it('writes no restore failure for a restore retry an engine retire forgot', async () => {
            mocks.setPluginState.mockRejectedValueOnce(new Error('chunk rejected'));
            await expect(activate(SAVED_CHUNK)).resolves.toMatchObject({ status: 'failed', stage: 'restore' });
            const retryWrite = Promise.withResolvers<void>();
            mocks.setPluginState.mockReturnValueOnce(retryWrite.promise);

            const retry = activate(SAVED_CHUNK);
            await vi.waitFor(() => expect(mocks.setPluginState).toHaveBeenCalledTimes(2));
            forgetRetiredPluginInstances([INSTANCE_ID]);
            retryWrite.reject(new Error(`unknown plugin instance ${INSTANCE_ID}`));

            await expect(retry).resolves.toMatchObject({ status: 'failed', stage: 'restore' });
            expect(externalPluginRestoreFailures.has(INSTANCE_ID)).toBe(false);
            expect(externalPluginActivationStore.value?.byInstanceId[INSTANCE_ID]?.status).not.toBe('error');
        });

        // A rebuild ends the generation, then waits on the retry before it unloads and clears anything.
        it('marks a restore retry a graph rebuild is waiting on so the rebuild carries no defaults', async () => {
            mocks.setPluginState.mockRejectedValueOnce(new Error('chunk rejected'));
            await expect(activate(SAVED_CHUNK)).resolves.toMatchObject({ status: 'failed', stage: 'restore' });
            externalPluginRestoreFailures.clear();
            const retryWrite = Promise.withResolvers<void>();
            mocks.setPluginState.mockReturnValueOnce(retryWrite.promise);
            const nativeUnload = Promise.withResolvers<Awaited<ReturnType<typeof unloadPluginRepoSignature>>>();
            mocks.unloadPlugin.mockReturnValueOnce(nativeUnload.promise);

            const retry = activate(SAVED_CHUNK);
            await vi.waitFor(() => expect(mocks.setPluginState).toHaveBeenCalledTimes(2));
            const rebuild = resetExternalPluginRuntimeForGraphRebuild();
            // A failed assertion must not leave the rebuild fence holding every later case.
            onTestFinished(async () => {
                nativeUnload.resolve({ unloadedInstanceIds: [INSTANCE_ID], errors: [], reports: [] });
                await rebuild;
            });
            retryWrite.reject(new Error('chunk rejected again'));

            await expect(retry).resolves.toMatchObject({ status: 'failed', stage: 'restore' });
            expect(externalPluginRestoreFailures.has(INSTANCE_ID)).toBe(true);
            nativeUnload.resolve({ unloadedInstanceIds: [INSTANCE_ID], errors: [], reports: [] });
            await rebuild;
            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(false);
        });

        it('marks a first-load restore a graph rebuild is waiting on so the rebuild carries no defaults', async () => {
            const firstWrite = Promise.withResolvers<void>();
            mocks.setPluginState.mockReturnValueOnce(firstWrite.promise);
            const nativeUnload = Promise.withResolvers<Awaited<ReturnType<typeof unloadPluginRepoSignature>>>();
            mocks.unloadPlugin.mockReturnValueOnce(nativeUnload.promise);

            const activation = activate(SAVED_CHUNK);
            await vi.waitFor(() => expect(mocks.setPluginState).toHaveBeenCalledOnce());
            const rebuild = resetExternalPluginRuntimeForGraphRebuild();
            // A failed assertion must not leave the rebuild fence holding every later case.
            onTestFinished(async () => {
                nativeUnload.resolve({ unloadedInstanceIds: [INSTANCE_ID], errors: [], reports: [] });
                await rebuild;
            });
            firstWrite.reject(new Error('chunk rejected'));

            await expect(activation).resolves.toMatchObject({ status: 'failed', stage: 'restore' });
            expect(externalPluginRestoreFailures.has(INSTANCE_ID)).toBe(true);
            nativeUnload.resolve({ unloadedInstanceIds: [INSTANCE_ID], errors: [], reports: [] });
            await rebuild;
            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(false);
        });

        it('leaves a newer activation of the id unmarked when the forgotten one restores into nothing', async () => {
            const firstWrite = Promise.withResolvers<void>();
            const secondWrite = Promise.withResolvers<void>();
            mocks.setPluginState.mockReturnValueOnce(firstWrite.promise).mockReturnValueOnce(secondWrite.promise);
            // A failed assertion must not leave the instance's lifecycle turn held for later cases.
            onTestFinished(() => {
                firstWrite.resolve();
                secondWrite.resolve();
            });

            const firstActivation = activate(SAVED_CHUNK);
            await vi.waitFor(() => expect(mocks.setPluginState).toHaveBeenCalledOnce());
            forgetRetiredPluginInstances([INSTANCE_ID]);
            // The newer load queues behind the forgotten activation's restore on the instance's lifecycle.
            const newerActivation = activate(SAVED_CHUNK);
            firstWrite.reject(new Error(`unknown plugin instance ${INSTANCE_ID}`));

            await expect(firstActivation).resolves.toMatchObject({ status: 'failed', stage: 'restore' });
            expect(externalPluginRestoreFailures.has(INSTANCE_ID)).toBe(false);
            expect(externalPluginActivationStore.value?.byInstanceId[INSTANCE_ID]?.status).not.toBe('error');
            secondWrite.resolve();
            await expect(newerActivation).resolves.toEqual({ status: 'active' });
        });

        // A graph rebuild or whole-runtime clear admitted while the activation waits owns the instance.
        it('does not reload a waiting reactivation once the runtime is cleared', async () => {
            await activateAndEdit(SAVED_CHUNK);
            const nativeUnload = Promise.withResolvers<Awaited<ReturnType<typeof unloadPluginRepoSignature>>>();
            mocks.unloadPlugin.mockReturnValueOnce(nativeUnload.promise);

            const removal = unloadPluginCarryingLiveState(INSTANCE_ID);
            await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledOnce());
            const reactivation = activate(SAVED_CHUNK);
            clearLoadedExternalPlugins();
            nativeUnload.resolve({ unloadedInstanceIds: [INSTANCE_ID], errors: [], reports: [] });
            await removal;

            await expect(reactivation).resolves.toMatchObject({ status: 'failed', stage: 'load' });
            expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(false);
            expect(mocks.loadPlugin).toHaveBeenCalledOnce();
        });

        it.each([
            ['saved', SAVED_CHUNK],
            ['never saved', undefined],
        ])('restores the live bytes, not the project chunk, on reactivation (%s)', async (_label, chunk) => {
            await activateAndEdit(chunk);

            await unloadPluginCarryingLiveState(INSTANCE_ID);
            expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(false);
            await expect(activate(chunk)).resolves.toEqual({ status: 'active' });

            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, LIVE_BYTES]]);
            // Consumed once: a second teardown that carries nothing gets the project chunk.
            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(false);
        });

        it('leaves the plain unload carrying nothing', async () => {
            await activateAndEdit(SAVED_CHUNK);

            await unloadPlugin(INSTANCE_ID);
            await activate(SAVED_CHUNK);

            expect(mocks.getPluginState).not.toHaveBeenCalled();
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it('warns by plugin name and falls back to the project chunk when the read rejects', async () => {
            await activateAndEdit(SAVED_CHUNK);
            mocks.getPluginState.mockRejectedValueOnce(new Error('pending parameter writes awaiting audio processing'));

            await unloadPluginCarryingLiveState(INSTANCE_ID);
            expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(false);
            await activate(SAVED_CHUNK);

            expect(warnings()).toEqual([expect.stringContaining(PLUGIN_ID)]);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it.each([
            ['saved', SAVED_CHUNK, [[INSTANCE_ID, SAVED_BYTES]]],
            ['never saved', undefined, []],
        ])(
            'completes the teardown and warns when the read never settles (%s)',
            async (_label, chunk, expectedRestores) => {
                await activateAndEdit(chunk);
                vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
                const lateRead = Promise.withResolvers<Uint8Array>();
                mocks.getPluginState.mockReturnValueOnce(lateRead.promise);

                const teardown = unloadPluginCarryingLiveState(INSTANCE_ID);
                await vi.advanceTimersByTimeAsync(5_000);
                await teardown;
                vi.useRealTimers();

                expect(mocks.unloadPlugin).toHaveBeenCalledWith(INSTANCE_ID);
                expect(warnings()).toEqual([expect.stringContaining(PLUGIN_ID)]);
                // An answer after the deadline must carry nothing.
                lateRead.resolve(LIVE_BYTES);
                await activate(chunk);
                expect(mocks.setPluginState.mock.calls).toEqual(expectedRestores);
            }
        );

        it.each([
            ['reports an error', () => Promise.resolve({ unloadedInstanceIds: [], errors: ['busy'], reports: [] })],
            ['rejects', () => Promise.reject(new Error('bridge down'))],
        ])('keeps no carry when the unload %s', async (_label, failedUnload) => {
            await activateAndEdit(SAVED_CHUNK);
            mocks.unloadPlugin.mockImplementationOnce(failedUnload);

            await expect(unloadPluginCarryingLiveState(INSTANCE_ID)).rejects.toThrow();
            expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(true);
            // The instance survives, so a later non-carrying teardown is what destroys it.
            await unloadPlugin(INSTANCE_ID);
            await activate(SAVED_CHUNK);

            expect(carriedExternalPluginStates.size).toBe(0);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it('carries nothing and warns nothing when the read returns no bytes', async () => {
            await activateAndEdit(SAVED_CHUNK);
            mocks.getPluginState.mockResolvedValueOnce(new Uint8Array());

            await unloadPluginCarryingLiveState(INSTANCE_ID);
            expect(carriedExternalPluginStates.size).toBe(0);
            await activate(SAVED_CHUNK);

            expect(mocks.notifyUser).not.toHaveBeenCalled();
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it('carries nothing when a restore failure is marked while the read is pending', async () => {
            await activateAndEdit(SAVED_CHUNK);
            const heldRead = Promise.withResolvers<Uint8Array>();
            mocks.getPluginState.mockReturnValueOnce(heldRead.promise);
            // Answer however the case ends, so a held read cannot leak into later cases.
            onTestFinished(() => heldRead.resolve(LIVE_BYTES));

            const teardown = unloadPluginCarryingLiveState(INSTANCE_ID);
            await vi.waitFor(() => expect(mocks.getPluginState).toHaveBeenCalledOnce());
            markExternalPluginRestoreFailure(INSTANCE_ID);
            heldRead.resolve(LIVE_BYTES);
            await teardown;

            expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(false);
            expect(carriedExternalPluginStates.size).toBe(0);
            await activate(SAVED_CHUNK);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it.each([
            ['the removal unload', () => unloadPluginCarryingLiveState(INSTANCE_ID)],
            [
                'the engine retire',
                async () => {
                    const reading = await readExternalPluginStatesBeforeEngineRetire();
                    reading.commit([INSTANCE_ID]);
                    forgetRetiredPluginInstances([INSTANCE_ID]);
                },
            ],
        ])('reads nothing for an instance marked as a failed restore before %s', async (_label, teardown) => {
            mocks.setPluginState.mockRejectedValueOnce(new Error('chunk rejected'));
            await expect(activate(SAVED_CHUNK)).resolves.toMatchObject({ status: 'failed', stage: 'restore' });
            expect(externalPluginRestoreFailures.has(INSTANCE_ID)).toBe(true);
            mocks.setPluginState.mockClear();
            // A read reaching the bridge would reject and warn the user.
            mocks.getPluginState.mockRejectedValue(new Error('control lock timed out'));

            await teardown();
            expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(false);

            expect(mocks.getPluginState).not.toHaveBeenCalled();
            expect(carriedExternalPluginStates.size).toBe(0);
            expect(warnings()).toEqual([]);
            await expect(activate(SAVED_CHUNK)).resolves.toEqual({ status: 'active' });
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it('reads nothing for an instance whose activation is still pending', async () => {
            const load = Promise.withResolvers<PluginInstance>();
            mocks.loadPlugin.mockReturnValueOnce(load.promise);
            const activation = activate(SAVED_CHUNK);

            const teardown = unloadPluginCarryingLiveState(INSTANCE_ID);
            load.resolve(pluginInstance());
            await teardown;
            await activation;

            expect(mocks.getPluginState).not.toHaveBeenCalled();
            expect(carriedExternalPluginStates.size).toBe(0);
            expect(warnings()).toEqual([]);
        });

        it('drops the carry when the whole runtime unloads for a project replacement', async () => {
            await activateAndEdit(SAVED_CHUNK);
            await unloadPluginCarryingLiveState(INSTANCE_ID);

            // Discard changes, Open, New and template load all replace the
            // project through the unkeyed unload; the reloaded device keeps its
            // persisted instance id.
            await unloadPlugin();
            await activate(SAVED_CHUNK);

            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it.each([
            ['rejects', () => Promise.reject(new Error('bridge down'))],
            ['reports an error', () => Promise.resolve({ unloadedInstanceIds: [], errors: ['busy'], reports: [] })],
        ])('drops the carry when the whole-runtime unload %s', async (_label, failedUnload) => {
            await activateAndEdit(SAVED_CHUNK);
            await unloadPluginCarryingLiveState(INSTANCE_ID);
            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(true);
            mocks.unloadPlugin.mockImplementationOnce(failedUnload);

            await expect(unloadPlugin()).rejects.toThrow();
            expect(carriedExternalPluginStates.size).toBe(0);
            await activate(SAVED_CHUNK);

            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it('discards a read batch started before a failed whole-runtime unload', async () => {
            await activateAndEdit(SAVED_CHUNK);
            const reading = await readExternalPluginStatesBeforeEngineRetire();
            mocks.unloadPlugin.mockRejectedValueOnce(new Error('bridge down'));

            await expect(unloadPlugin()).rejects.toThrow('bridge down');
            reading.commit([INSTANCE_ID]);

            expect(carriedExternalPluginStates.size).toBe(0);
            await unloadPlugin(INSTANCE_ID);
            await activate(SAVED_CHUNK);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });
    });

    describe('project switch', () => {
        it('restores the live bytes, not the project chunk, when the switch is refused', async () => {
            await activateAndEdit(SAVED_CHUNK);

            await unloadPluginsBeforeProjectSwitch();
            expect(loadedExternalInstances.size).toBe(0);
            settleProjectSwitchPluginTeardown('refused');
            await activate(SAVED_CHUNK);

            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, LIVE_BYTES]]);
            expect(warnings()).toEqual([]);
        });

        it("keeps the outgoing project's removal carry when the switch is refused", async () => {
            await activateBothAndEdit();
            await unloadPluginCarryingLiveState(OTHER_INSTANCE_ID);

            await unloadPluginsBeforeProjectSwitch();
            settleProjectSwitchPluginTeardown('refused');

            expect(await reactivateBoth()).toEqual([
                [INSTANCE_ID, LIVE_BYTES],
                [OTHER_INSTANCE_ID, OTHER_LIVE_BYTES],
            ]);
        });

        it('lets a Play before the switch consume the carry', async () => {
            await activateAndEdit(SAVED_CHUNK);

            await unloadPluginsBeforeProjectSwitch();
            // The outgoing project's strips rebuilt by a Play landing before the switch.
            await activate(SAVED_CHUNK);

            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, LIVE_BYTES]]);
        });

        it('drops every carry, the removal carries included, when the switch happens', async () => {
            await activateBothAndEdit();
            await unloadPluginCarryingLiveState(OTHER_INSTANCE_ID);

            await unloadPluginsBeforeProjectSwitch();
            settleProjectSwitchPluginTeardown('switched');

            expect(carriedExternalPluginStates.size).toBe(0);
            expect(await reactivateBoth()).toEqual([
                [INSTANCE_ID, SAVED_BYTES],
                [OTHER_INSTANCE_ID, SAVED_BYTES],
            ]);
        });

        it('warns by plugin name about an unreadable instance only when the switch is refused', async () => {
            await activateAndEdit(SAVED_CHUNK);
            mocks.getPluginState.mockRejectedValueOnce(new Error('control lock timed out'));

            await unloadPluginsBeforeProjectSwitch();
            expect(warnings()).toEqual([]);
            settleProjectSwitchPluginTeardown('refused');
            await activate(SAVED_CHUNK);

            expect(warnings()).toEqual([expect.stringContaining(PLUGIN_ID)]);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it('says nothing about an unreadable instance when the switch happens', async () => {
            await activateAndEdit(SAVED_CHUNK);
            mocks.getPluginState.mockRejectedValueOnce(new Error('control lock timed out'));

            await unloadPluginsBeforeProjectSwitch();
            settleProjectSwitchPluginTeardown('switched');
            settleProjectSwitchPluginTeardown('refused');

            expect(warnings()).toEqual([]);
        });

        it('carries nothing for an instance a failed unload left loaded', async () => {
            await activateAndEdit(SAVED_CHUNK);
            mocks.unloadPlugin.mockRejectedValueOnce(new Error('bridge down'));

            await expect(unloadPluginsBeforeProjectSwitch()).rejects.toThrow('bridge down');
            settleProjectSwitchPluginTeardown('refused');

            expect(carriedExternalPluginStates.size).toBe(0);
            expect(warnings()).toEqual([]);
        });

        describe('when the unload tears one instance down and reports an error for the other', () => {
            function unloadOnlyFirstInstance(): void {
                mocks.unloadPlugin.mockImplementationOnce(() =>
                    Promise.resolve({
                        unloadedInstanceIds: [INSTANCE_ID],
                        errors: [`${OTHER_INSTANCE_ID} is busy`],
                        reports: [],
                    })
                );
            }

            it('carries the torn-down instance and nothing for the one left loaded', async () => {
                await activateBothAndEdit();
                unloadOnlyFirstInstance();

                await expect(unloadPluginsBeforeProjectSwitch()).rejects.toThrow(`${OTHER_INSTANCE_ID} is busy`);
                settleProjectSwitchPluginTeardown('refused');

                expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(false);
                expect(loadedExternalInstances.has(OTHER_INSTANCE_ID)).toBe(true);
                expect([...carriedExternalPluginStates.keys()]).toEqual([INSTANCE_ID]);
                await activate(SAVED_CHUNK);
                expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, LIVE_BYTES]]);
                expect(warnings()).toEqual([]);
            });

            it('warns about the torn-down instance whose state could not be read', async () => {
                await activateBothAndEdit();
                mocks.getPluginState.mockImplementation((instanceId) => {
                    if (instanceId === INSTANCE_ID) {
                        return Promise.reject(new Error('control lock timed out'));
                    }
                    return Promise.resolve(OTHER_LIVE_BYTES);
                });
                unloadOnlyFirstInstance();

                await expect(unloadPluginsBeforeProjectSwitch()).rejects.toThrow(`${OTHER_INSTANCE_ID} is busy`);
                expect(warnings()).toEqual([]);
                settleProjectSwitchPluginTeardown('refused');
                await activate(SAVED_CHUNK);

                expect(warnings()).toEqual([expect.stringContaining(PLUGIN_ID)]);
                expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
            });
        });
    });

    describe('graph repair', () => {
        it.each([
            ['saved', SAVED_CHUNK],
            ['never saved', undefined],
        ])('restores the live bytes on reactivation (%s)', async (_label, chunk) => {
            await activateAndEdit(chunk);

            await resetExternalPluginRuntimeForGraphRebuild();
            expect(loadedExternalInstances.size).toBe(0);
            await activate(chunk);

            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, LIVE_BYTES]]);
        });

        it('warns and falls back to the project chunk when the read rejects', async () => {
            await activateAndEdit(SAVED_CHUNK);
            mocks.getPluginState.mockRejectedValueOnce(new Error('control lock timed out'));

            await resetExternalPluginRuntimeForGraphRebuild();
            await activate(SAVED_CHUNK);

            expect(warnings()).toEqual([expect.stringContaining(PLUGIN_ID)]);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it.each([
            ['reports an error', () => Promise.resolve({ unloadedInstanceIds: [], errors: ['busy'], reports: [] })],
            ['rejects', () => Promise.reject(new Error('bridge down'))],
        ])('keeps no carry when the unload %s', async (_label, failedUnload) => {
            await activateAndEdit(SAVED_CHUNK);
            mocks.unloadPlugin.mockImplementationOnce(failedUnload);

            await expect(resetExternalPluginRuntimeForGraphRebuild()).rejects.toThrow();
            expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(true);
            expect(carriedExternalPluginStates.size).toBe(0);
            // The instance survives, so a later non-carrying teardown is what destroys it.
            await unloadPlugin(INSTANCE_ID);
            await activate(SAVED_CHUNK);

            expect(carriedExternalPluginStates.size).toBe(0);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it('keeps the carry for the next activation when a rebuild supersedes the one consuming it', async () => {
            await activateAndEdit(SAVED_CHUNK);
            await unloadPluginCarryingLiveState(INSTANCE_ID);
            const load = Promise.withResolvers<PluginInstance>();
            mocks.loadPlugin.mockReturnValueOnce(load.promise);

            const superseded = activate(SAVED_CHUNK);
            const repair = resetExternalPluginRuntimeForGraphRebuild();
            load.resolve(pluginInstance());
            await expect(superseded).resolves.toMatchObject({ status: 'failed' });
            await repair;
            await activate(SAVED_CHUNK);

            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, LIVE_BYTES]]);
        });

        it('keeps the carry for the next activation when a rebuild lands while the carried restore is pending', async () => {
            await activateAndEdit(SAVED_CHUNK);
            await unloadPluginCarryingLiveState(INSTANCE_ID);
            const heldRestore = Promise.withResolvers<void>();
            mocks.setPluginState.mockReturnValueOnce(heldRestore.promise);
            // Release the held restore however the case ends, so it cannot leak into later cases.
            onTestFinished(() => heldRestore.resolve());

            const superseded = activate(SAVED_CHUNK);
            await vi.waitFor(() => expect(mocks.setPluginState).toHaveBeenCalledOnce());
            // The epoch bump lands now; the repair waits for the admitted activation.
            const repair = resetExternalPluginRuntimeForGraphRebuild();
            heldRestore.resolve();

            await expect(superseded).resolves.toMatchObject({
                status: 'failed',
                stage: 'restore',
                reason: expect.stringContaining('superseded'),
            });
            await repair;
            mocks.setPluginState.mockClear();
            await expect(activate(SAVED_CHUNK)).resolves.toEqual({ status: 'active' });

            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, LIVE_BYTES]]);
        });

        it('leaves the carry to a newer activation when the forgotten one rejects it', async () => {
            await activateAndEdit(SAVED_CHUNK);
            await unloadPluginCarryingLiveState(INSTANCE_ID);
            const heldRestore = Promise.withResolvers<void>();
            mocks.setPluginState.mockReturnValueOnce(heldRestore.promise);
            // Release the held restore however the case ends, so it cannot leak into later cases.
            onTestFinished(() => heldRestore.resolve());

            const forgotten = activate(SAVED_CHUNK);
            await vi.waitFor(() => expect(mocks.setPluginState).toHaveBeenCalledOnce());
            forgetRetiredPluginInstances([INSTANCE_ID]);
            // The newer load queues behind the forgotten activation's restore on the instance's lifecycle.
            const newer = activate(SAVED_CHUNK);
            heldRestore.reject(new Error(`unknown plugin instance ${INSTANCE_ID}`));

            await expect(forgotten).resolves.toMatchObject({
                status: 'failed',
                stage: 'restore',
                reason: expect.stringContaining('superseded'),
            });
            await expect(newer).resolves.toEqual({ status: 'active' });
            expect(mocks.setPluginState.mock.calls).toEqual([
                [INSTANCE_ID, LIVE_BYTES],
                [INSTANCE_ID, LIVE_BYTES],
            ]);
            expect(externalPluginRestoreFailures.has(INSTANCE_ID)).toBe(false);
        });

        it('carries only the instances the unload destroyed when another fails', async () => {
            await activateBothAndEdit();
            mocks.unloadPlugin.mockResolvedValueOnce({
                unloadedInstanceIds: [INSTANCE_ID],
                errors: [`${OTHER_INSTANCE_ID} busy`],
                reports: [],
            });

            await expect(resetExternalPluginRuntimeForGraphRebuild()).rejects.toThrow('busy');
            expect(loadedExternalInstances.has(OTHER_INSTANCE_ID)).toBe(true);
            // The survivor is destroyed later by a non-carrying teardown.
            await unloadPlugin(OTHER_INSTANCE_ID);

            expect(await reactivateBoth()).toEqual([
                [INSTANCE_ID, LIVE_BYTES],
                [OTHER_INSTANCE_ID, SAVED_BYTES],
            ]);
        });
    });

    describe('engine retire', () => {
        it('restores the live bytes when the read is committed for a retired instance', async () => {
            await activateAndEdit(SAVED_CHUNK);

            const reading = await readExternalPluginStatesBeforeEngineRetire();
            reading.commit([INSTANCE_ID]);
            forgetRetiredPluginInstances([INSTANCE_ID]);
            await activate(SAVED_CHUNK);

            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, LIVE_BYTES]]);
        });

        it('carries nothing for an instance the retire did not destroy', async () => {
            await activateAndEdit(SAVED_CHUNK);

            const reading = await readExternalPluginStatesBeforeEngineRetire();
            reading.commit([]);
            await unloadPlugin(INSTANCE_ID);
            await activate(SAVED_CHUNK);

            expect(carriedExternalPluginStates.size).toBe(0);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it('warns and falls back to the project chunk when the read never settles', async () => {
            await activateAndEdit(SAVED_CHUNK);
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            const lateRead = Promise.withResolvers<Uint8Array>();
            mocks.getPluginState.mockReturnValueOnce(lateRead.promise);

            const pendingReading = readExternalPluginStatesBeforeEngineRetire();
            await vi.advanceTimersByTimeAsync(5_000);
            const reading = await pendingReading;
            vi.useRealTimers();
            reading.commit([INSTANCE_ID]);
            forgetRetiredPluginInstances([INSTANCE_ID]);
            // The read's answer, arriving after the deadline, must carry nothing.
            lateRead.resolve(LIVE_BYTES);
            await activate(SAVED_CHUNK);

            expect(warnings()).toEqual([expect.stringContaining(PLUGIN_ID)]);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it('releases the lifecycle turn at the deadline so a later rebuild can proceed', async () => {
            await activateAndEdit(SAVED_CHUNK);
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            const hungRead = Promise.withResolvers<Uint8Array>();
            mocks.getPluginState.mockReturnValueOnce(hungRead.promise);
            // Answer at last once the case is over, so a wedged turn cannot leak into later cases.
            onTestFinished(() => hungRead.resolve(LIVE_BYTES));

            const pendingReading = readExternalPluginStatesBeforeEngineRetire();
            await vi.advanceTimersByTimeAsync(5_000);
            await pendingReading;
            let repaired = false;
            void resetExternalPluginRuntimeForGraphRebuild().then(() => {
                repaired = true;
                return repaired;
            });
            await vi.advanceTimersByTimeAsync(5_000);

            expect(repaired).toBe(true);
        });

        it("reads only after the instance's current lifecycle turn settles", async () => {
            await activateAndEdit(SAVED_CHUNK);
            const heldRestore = Promise.withResolvers<void>();
            mocks.setPluginState.mockReturnValueOnce(heldRestore.promise);
            // Release the held turn however the case ends, so it cannot leak into later cases.
            onTestFinished(() => heldRestore.resolve());
            const restore = restorePluginState(INSTANCE_ID, SAVED_CHUNK);
            await vi.waitFor(() => expect(mocks.setPluginState).toHaveBeenCalledOnce());

            const pendingReading = readExternalPluginStatesBeforeEngineRetire();
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(mocks.getPluginState).not.toHaveBeenCalled();

            heldRestore.resolve();
            await restore;
            await pendingReading;
            expect(mocks.getPluginState).toHaveBeenCalledOnce();
        });

        it('reads nothing for an instance whose activation is still pending', async () => {
            const load = Promise.withResolvers<PluginInstance>();
            mocks.loadPlugin.mockReturnValueOnce(load.promise);
            const activation = activate(SAVED_CHUNK);

            const pendingReading = readExternalPluginStatesBeforeEngineRetire();
            load.resolve(pluginInstance());
            const reading = await pendingReading;
            reading.commit([INSTANCE_ID]);
            await activation;

            expect(mocks.getPluginState).not.toHaveBeenCalled();
            expect(carriedExternalPluginStates.size).toBe(0);
            expect(warnings()).toEqual([]);
        });

        it('carries only the instances the retire reports destroyed', async () => {
            await activateBothAndEdit();

            const reading = await readExternalPluginStatesBeforeEngineRetire();
            reading.commit([INSTANCE_ID]);
            forgetRetiredPluginInstances([INSTANCE_ID]);
            // The survivor is destroyed later by a non-carrying teardown.
            await unloadPlugin(OTHER_INSTANCE_ID);

            expect(await reactivateBoth()).toEqual([
                [INSTANCE_ID, LIVE_BYTES],
                [OTHER_INSTANCE_ID, SAVED_BYTES],
            ]);
        });

        it('discards a commit that lands after a project replacement dropped the carries', async () => {
            await activateAndEdit(SAVED_CHUNK);

            const reading = await readExternalPluginStatesBeforeEngineRetire();
            await unloadPlugin();
            reading.commit([INSTANCE_ID]);

            expect(carriedExternalPluginStates.size).toBe(0);
            await activate(SAVED_CHUNK);
            expect(warnings()).toEqual([]);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });
    });

    describe('engine retire racing the same instance id', () => {
        it('keeps the newer carry a removal wrote after the retire read', async () => {
            await activateAndEdit(SAVED_CHUNK);

            const reading = await readExternalPluginStatesBeforeEngineRetire();
            mocks.getPluginState.mockResolvedValue(NEWER_LIVE_BYTES);
            await unloadPluginCarryingLiveState(INSTANCE_ID);
            reading.commit([INSTANCE_ID]);
            forgetRetiredPluginInstances([INSTANCE_ID]);
            await activate(SAVED_CHUNK);

            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, NEWER_LIVE_BYTES]]);
            expect(warnings()).toEqual([]);
        });

        it('plants no carry on the instance a reactivation brought back', async () => {
            await activateAndEdit(SAVED_CHUNK);

            const reading = await readExternalPluginStatesBeforeEngineRetire();
            await unloadPluginCarryingLiveState(INSTANCE_ID);
            await expect(activate(SAVED_CHUNK)).resolves.toEqual({ status: 'active' });
            reading.commit([INSTANCE_ID]);

            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(false);
            // A later plain unload restores the project chunk, not the stale read.
            await unloadPlugin(INSTANCE_ID);
            mocks.setPluginState.mockClear();
            await activate(SAVED_CHUNK);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it('plants no carry on an instance a plain unload and carry-less reactivation brought back', async () => {
            await activateAndEdit(SAVED_CHUNK);

            const reading = await readExternalPluginStatesBeforeEngineRetire();
            await unloadPlugin(INSTANCE_ID);
            await expect(activate(SAVED_CHUNK)).resolves.toEqual({ status: 'active' });
            reading.commit([INSTANCE_ID]);

            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(false);
            // A later plain unload restores the project chunk, not the stale read.
            await unloadPlugin(INSTANCE_ID);
            mocks.setPluginState.mockClear();
            await activate(SAVED_CHUNK);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it('plants no carry on an instance the incoming project reactivated back to the stamped slot', async () => {
            await activateAndEdit(SAVED_CHUNK);
            const stamp = carriedExternalPluginStateFence.slotVersion(INSTANCE_ID);
            expect(stamp).toBeGreaterThan(0);

            const reading = await readExternalPluginStatesBeforeEngineRetire();
            // The project replacement drops the carries and their slot versions.
            await unloadPlugin();
            expect(carriedExternalPluginStateFence.slotVersion(INSTANCE_ID)).toBe(0);
            // The incoming project brings the same persisted instance id back;
            // each activation advances the slot by one, so the slot climbs back
            // to the stamp and only the generation fence still tells them apart.
            for (let activation = 1; activation <= stamp; activation += 1) {
                if (activation > 1) {
                    await unloadPlugin(INSTANCE_ID);
                }
                await expect(activate(SAVED_CHUNK)).resolves.toEqual({ status: 'active' });
            }
            expect(carriedExternalPluginStateFence.slotVersion(INSTANCE_ID)).toBe(stamp);
            reading.commit([INSTANCE_ID]);

            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(false);
            expect(warnings()).toEqual([]);
            // A later plain unload restores the incoming project's chunk, not the stale read.
            await unloadPlugin(INSTANCE_ID);
            mocks.setPluginState.mockClear();
            await activate(SAVED_CHUNK);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it('warns by plugin name when the retire destroys an instance activated with a carry after its read batch', async () => {
            await activateAndEdit(SAVED_CHUNK);
            await unloadPluginCarryingLiveState(INSTANCE_ID);
            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(true);

            const reading = await readExternalPluginStatesBeforeEngineRetire();
            // Undo of the removal restores the carry, which the settled activation consumes.
            await expect(activate(SAVED_CHUNK)).resolves.toEqual({ status: 'active' });
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, LIVE_BYTES]]);
            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(false);
            reading.commit([INSTANCE_ID]);
            forgetRetiredPluginInstances([INSTANCE_ID]);

            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(false);
            expect(warnings()).toEqual([expect.stringContaining(PLUGIN_ID)]);
        });

        it('warns by plugin name when the retire destroys an instance unloaded and reactivated after its read', async () => {
            await activateAndEdit(SAVED_CHUNK);

            const reading = await readExternalPluginStatesBeforeEngineRetire();
            await unloadPlugin(INSTANCE_ID);
            await expect(activate(SAVED_CHUNK)).resolves.toEqual({ status: 'active' });
            reading.commit([INSTANCE_ID]);
            forgetRetiredPluginInstances([INSTANCE_ID]);

            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(false);
            expect(warnings()).toEqual([expect.stringContaining(PLUGIN_ID)]);
        });

        it('does not warn for a retired instance activated after its read batch whose restore failed', async () => {
            const reading = await readExternalPluginStatesBeforeEngineRetire();
            mocks.setPluginState.mockRejectedValueOnce(new Error('chunk rejected'));
            await expect(activate(SAVED_CHUNK)).resolves.toMatchObject({ status: 'failed', stage: 'restore' });
            expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(true);
            expect(externalPluginRestoreFailures.has(INSTANCE_ID)).toBe(true);
            reading.commit([INSTANCE_ID]);
            forgetRetiredPluginInstances([INSTANCE_ID]);

            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(false);
            expect(warnings()).toEqual([]);
        });

        it('does not revive a carry the plugin rejected', async () => {
            await activateAndEdit(SAVED_CHUNK);
            await unloadPluginCarryingLiveState(INSTANCE_ID);
            const load = Promise.withResolvers<PluginInstance>();
            mocks.loadPlugin.mockReturnValueOnce(load.promise);
            mocks.setPluginState.mockRejectedValueOnce(new Error('chunk rejected'));

            const reactivation = activate(SAVED_CHUNK);
            const pendingReading = readExternalPluginStatesBeforeEngineRetire();
            load.resolve(pluginInstance());
            await expect(reactivation).resolves.toEqual({ status: 'active' });
            const reading = await pendingReading;
            reading.commit([INSTANCE_ID]);
            forgetRetiredPluginInstances([INSTANCE_ID]);

            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(false);
            mocks.setPluginState.mockClear();
            await activate(SAVED_CHUNK);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
            // The rejection, then the retire destroying what the instance held after the fallback, unread.
            expect(warnings()).toEqual([
                expect.stringMatching(new RegExp(`^Unsaved edits in ${PLUGIN_ID} could not be restored`)),
                expect.stringMatching(new RegExp(`^Unsaved edits in ${PLUGIN_ID} could not be read before unloading`)),
            ]);
        });
    });

    describe('reactivation', () => {
        it('warns and restores the project chunk when the plugin rejects the carried bytes', async () => {
            await activateAndEdit(SAVED_CHUNK);
            await unloadPluginCarryingLiveState(INSTANCE_ID);
            mocks.setPluginState.mockRejectedValueOnce(new Error('chunk rejected'));

            await expect(activate(SAVED_CHUNK)).resolves.toEqual({ status: 'active' });

            expect(mocks.setPluginState.mock.calls).toEqual([
                [INSTANCE_ID, LIVE_BYTES],
                [INSTANCE_ID, SAVED_BYTES],
            ]);
            expect(warnings()).toEqual([expect.stringContaining(PLUGIN_ID)]);
            expect(carriedExternalPluginStates.size).toBe(0);
        });

        it('keeps the carry for the next activation when the instance is forgotten while the carried restore is pending', async () => {
            await activateAndEdit(SAVED_CHUNK);
            await unloadPluginCarryingLiveState(INSTANCE_ID);
            const heldRestore = Promise.withResolvers<void>();
            mocks.setPluginState.mockReturnValueOnce(heldRestore.promise);
            // Release the held restore however the case ends, so it cannot leak into later cases.
            onTestFinished(() => heldRestore.resolve());

            const superseded = activate(SAVED_CHUNK);
            await vi.waitFor(() => expect(mocks.setPluginState).toHaveBeenCalledOnce());
            // An engine retire forgets the instance without bumping the activation epoch.
            forgetRetiredPluginInstances([INSTANCE_ID]);
            heldRestore.resolve();

            await expect(superseded).resolves.toMatchObject({
                status: 'failed',
                stage: 'restore',
                reason: expect.stringContaining('superseded'),
            });
            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(true);
            mocks.setPluginState.mockClear();
            await expect(activate(SAVED_CHUNK)).resolves.toEqual({ status: 'active' });

            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, LIVE_BYTES]]);
        });

        it('restores the live bytes after a second removal lands while the carried restore is pending', async () => {
            await activateAndEdit(SAVED_CHUNK);
            await unloadPluginCarryingLiveState(INSTANCE_ID);
            const heldRestore = Promise.withResolvers<void>();
            mocks.setPluginState.mockReturnValueOnce(heldRestore.promise);
            // Release the held restore however the case ends, so it cannot leak into later cases.
            onTestFinished(() => heldRestore.resolve());

            const reactivation = activate(SAVED_CHUNK);
            await vi.waitFor(() => expect(mocks.setPluginState).toHaveBeenCalledOnce());
            const secondRemoval = unloadPluginCarryingLiveState(INSTANCE_ID);
            heldRestore.resolve();
            await reactivation;
            await secondRemoval;
            expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(false);
            mocks.setPluginState.mockClear();
            await expect(activate(SAVED_CHUNK)).resolves.toEqual({ status: 'active' });

            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, LIVE_BYTES]]);
            expect(warnings()).toEqual([]);
        });

        it('reloads with the live bytes when activated while the removal unload is still pending', async () => {
            await activateAndEdit(SAVED_CHUNK);
            const heldUnload = Promise.withResolvers<Awaited<ReturnType<typeof unloadPluginRepoSignature>>>();
            mocks.unloadPlugin.mockReturnValueOnce(heldUnload.promise);
            // Release the held unload however the case ends, so it cannot leak into later cases.
            onTestFinished(() => heldUnload.resolve({ unloadedInstanceIds: [INSTANCE_ID], errors: [], reports: [] }));

            const removal = unloadPluginCarryingLiveState(INSTANCE_ID);
            await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith(INSTANCE_ID));
            const reactivation = activate(SAVED_CHUNK);
            heldUnload.resolve({ unloadedInstanceIds: [INSTANCE_ID], errors: [], reports: [] });
            await removal;

            await expect(reactivation).resolves.toEqual({ status: 'active' });
            expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(true);
            expect(mocks.loadPlugin).toHaveBeenCalledTimes(2);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, LIVE_BYTES]]);
            expect(externalPluginActivationStore.value?.byInstanceId[INSTANCE_ID]).toEqual({ status: 'active' });
            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(false);
        });

        it('keeps the instance loaded without a second load when activated while the removal unload rejects', async () => {
            await activateAndEdit(SAVED_CHUNK);
            const heldUnload = Promise.withResolvers<Awaited<ReturnType<typeof unloadPluginRepoSignature>>>();
            mocks.unloadPlugin.mockReturnValueOnce(heldUnload.promise);
            // Settle the held unload however the case ends, so it cannot leak into later cases.
            onTestFinished(() => heldUnload.reject(new Error('bridge down')));

            const removal = unloadPluginCarryingLiveState(INSTANCE_ID);
            await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith(INSTANCE_ID));
            const reactivation = activate(SAVED_CHUNK);
            heldUnload.reject(new Error('bridge down'));
            await expect(removal).rejects.toThrow('bridge down');

            await expect(reactivation).resolves.toEqual({ status: 'active' });
            expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(true);
            expect(mocks.loadPlugin).toHaveBeenCalledOnce();
            expect(mocks.setPluginState).not.toHaveBeenCalled();
        });

        it('fails the activation without loading when the pending removal unload never answers', async () => {
            await activateAndEdit(SAVED_CHUNK);
            const heldUnload = Promise.withResolvers<Awaited<ReturnType<typeof unloadPluginRepoSignature>>>();
            mocks.unloadPlugin.mockReturnValueOnce(heldUnload.promise);
            // Release the held unload however the case ends, so it cannot leak into later cases.
            onTestFinished(() => heldUnload.resolve({ unloadedInstanceIds: [INSTANCE_ID], errors: [], reports: [] }));

            const removal = unloadPluginCarryingLiveState(INSTANCE_ID);
            await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith(INSTANCE_ID));
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            const reactivation = activate(SAVED_CHUNK);
            await vi.advanceTimersByTimeAsync(15_000);

            const reason = `${PLUGIN_ID} is still unloading and did not finish; it was not reactivated.`;
            await expect(reactivation).resolves.toEqual({ status: 'failed', stage: 'load', reason });
            expect(externalPluginActivationStore.value?.byInstanceId[INSTANCE_ID]).toEqual({
                status: 'error',
                message: reason,
            });
            expect(mocks.loadPlugin).toHaveBeenCalledOnce();
            vi.useRealTimers();
            heldUnload.resolve({ unloadedInstanceIds: [INSTANCE_ID], errors: [], reports: [] });
            await removal;
        });

        // Remove lands while the first activation is still loading, so the removal's unload takes the
        // lifecycle turn ahead of that activation's restore; Undo is issued while the unload is pending.
        it('restores the project chunk on a fresh load when Undo follows a removal that overtook the restore', async () => {
            const heldRestore = Promise.withResolvers<void>();
            mocks.setPluginState.mockReturnValueOnce(heldRestore.promise);
            const heldUnload = Promise.withResolvers<Awaited<ReturnType<typeof unloadPluginRepoSignature>>>();
            mocks.unloadPlugin.mockReturnValueOnce(heldUnload.promise);
            // Settle both held calls however the case ends, so they cannot leak into later cases.
            onTestFinished(() => {
                heldUnload.resolve({ unloadedInstanceIds: [INSTANCE_ID], errors: [], reports: [] });
                heldRestore.resolve();
            });

            const firstActivation = activate(SAVED_CHUNK);
            const removal = unloadPluginCarryingLiveState(INSTANCE_ID);
            const undo = activate(SAVED_CHUNK);
            await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith(INSTANCE_ID));
            heldUnload.resolve({ unloadedInstanceIds: [INSTANCE_ID], errors: [], reports: [] });
            await removal;
            heldRestore.resolve();

            await expect(undo).resolves.toEqual({ status: 'active' });
            await firstActivation;
            expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(true);
            expect(mocks.loadPlugin).toHaveBeenCalledTimes(2);
            expect(mocks.setPluginState.mock.calls).toEqual([
                [INSTANCE_ID, SAVED_BYTES],
                [INSTANCE_ID, SAVED_BYTES],
            ]);
            // The second restore is the Undo's, onto the instance its own fresh load brought back.
            expect(mocks.setPluginState.mock.invocationCallOrder[1]).toBeGreaterThan(
                mocks.loadPlugin.mock.invocationCallOrder[1] ?? Number.POSITIVE_INFINITY
            );
            expect(externalPluginRestoreFailures.has(INSTANCE_ID)).toBe(false);
            expect(externalPluginActivationStore.value?.byInstanceId[INSTANCE_ID]).toEqual({ status: 'active' });
            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(false);
        });

        describe('after a reactivation timed out on an unload that then rejected', () => {
            const TIMEOUT_REASON = `${PLUGIN_ID} is still unloading and did not finish; it was not reactivated.`;

            function slot() {
                return externalPluginActivationStore.value?.byInstanceId[INSTANCE_ID];
            }

            /**
             * Time a reactivation out on a held removal unload, run `duringWait` while the slot shows
             * the timeout error, then reject the unload so the instance stays loaded.
             */
            async function timeOutThenRejectUnload(duringWait: () => void = () => {}): Promise<void> {
                const heldUnload = Promise.withResolvers<Awaited<ReturnType<typeof unloadPluginRepoSignature>>>();
                mocks.unloadPlugin.mockReturnValueOnce(heldUnload.promise);
                // Settle the held unload however the case ends, so it cannot leak into later cases.
                onTestFinished(() => heldUnload.reject(new Error('bridge down')));

                const removal = unloadPluginCarryingLiveState(INSTANCE_ID);
                await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith(INSTANCE_ID));
                vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
                const timedOut = activate(SAVED_CHUNK);
                await vi.advanceTimersByTimeAsync(PENDING_UNLOAD_WAIT_TIMEOUT_MS);
                await expect(timedOut).resolves.toEqual({ status: 'failed', stage: 'load', reason: TIMEOUT_REASON });
                expect(slot()).toEqual({ status: 'error', message: TIMEOUT_REASON });
                vi.useRealTimers();
                duringWait();
                heldUnload.reject(new Error('bridge down'));
                await expect(removal).rejects.toThrow('bridge down');
                expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(true);
            }

            it('shows the instance active as soon as the unload rejects, and after it is activated again', async () => {
                await activateAndEdit(SAVED_CHUNK);

                await timeOutThenRejectUnload();

                expect(slot()).toEqual({ status: 'active' });
                await expect(activate(SAVED_CHUNK)).resolves.toEqual({ status: 'active' });
                expect(mocks.loadPlugin).toHaveBeenCalledOnce();
                expect(slot()).toEqual({ status: 'active' });
            });

            it('keeps the no-engine note for an instance the engine still has not taken', async () => {
                mocks.loadPlugin.mockResolvedValueOnce({ ...pluginInstance(), engine_plugin_id: null });
                await expect(activate(SAVED_CHUNK)).resolves.toEqual({ status: 'active', attachment: 'pending' });
                const noEngineSlot = slot();
                expect(noEngineSlot).toMatchObject({ status: 'active', message: expect.any(String) });

                await timeOutThenRejectUnload();

                expect(slot()).toEqual(noEngineSlot);
            });

            it('drops the no-engine note when the engine took the instance during the wait', async () => {
                mocks.loadPlugin.mockResolvedValueOnce({ ...pluginInstance(), engine_plugin_id: null });
                await expect(activate(SAVED_CHUNK)).resolves.toEqual({ status: 'active', attachment: 'pending' });

                await timeOutThenRejectUnload(() => markExternalPluginEngineAttached({ instanceId: INSTANCE_ID }));

                expect(slot()).toEqual({ status: 'active' });
            });

            it('shows the out-of-service message the host raised for the instance', async () => {
                await activateAndEdit(SAVED_CHUNK);
                const message = 'Out of service: it refused to start processing.';
                externalPluginServiceMessages.set(INSTANCE_ID, message);
                onTestFinished(() => externalPluginServiceMessages.delete(INSTANCE_ID));

                await timeOutThenRejectUnload();

                expect(slot()).toEqual({ status: 'active', message });
            });

            it('shows the restore failure of an instance that rejected its project chunk', async () => {
                mocks.setPluginState.mockRejectedValueOnce(new Error('chunk rejected'));
                await expect(activate(SAVED_CHUNK)).resolves.toMatchObject({ status: 'failed', stage: 'restore' });
                const restoreFailureSlot = slot();
                expect(restoreFailureSlot).toMatchObject({ status: 'error' });

                await timeOutThenRejectUnload();

                expect(slot()).toEqual(restoreFailureSlot);
            });

            it('keeps the status another writer replaced the timeout error with', async () => {
                await activateAndEdit(SAVED_CHUNK);

                await timeOutThenRejectUnload(() => failUnresponsiveExternalPlugins(new Set([INSTANCE_ID]), new Map()));

                expect(slot()).toEqual({ status: 'error', message: pluginUnresponsiveMessage(PLUGIN_ID) });
            });
        });

        it('leaves no carry once a carried restore settles, so a later plain unload restores the project chunk', async () => {
            await activateAndEdit(SAVED_CHUNK);
            await unloadPluginCarryingLiveState(INSTANCE_ID);
            await expect(activate(SAVED_CHUNK)).resolves.toEqual({ status: 'active' });
            expect(carriedExternalPluginStates.has(INSTANCE_ID)).toBe(false);

            await unloadPlugin(INSTANCE_ID);
            mocks.setPluginState.mockClear();
            await expect(activate(SAVED_CHUNK)).resolves.toEqual({ status: 'active' });

            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it('drops a carry for a different plugin on the same instance id', async () => {
            await activateAndEdit(SAVED_CHUNK);
            await unloadPluginCarryingLiveState(INSTANCE_ID);

            await activate(SAVED_CHUNK, 'other-plugin');

            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
            expect(carriedExternalPluginStates.size).toBe(0);
        });
    });

    describe('project session quiesce', () => {
        it('restores the live bytes, not the project chunk, when the quiesce is cancelled after retirement', async () => {
            await activateAndEdit(SAVED_CHUNK);

            const retirement = await beginProjectSessionPluginRetirement();
            await retirement.retire();
            expect(loadedExternalInstances.size).toBe(0);
            retirement.reopen();
            await activate(SAVED_CHUNK);

            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, LIVE_BYTES]]);
            expect(warnings()).toEqual([]);
        });

        it('keeps a removal carry from before the quiesce when the quiesce is cancelled', async () => {
            await activateBothAndEdit();
            await unloadPluginCarryingLiveState(OTHER_INSTANCE_ID);

            const retirement = await beginProjectSessionPluginRetirement();
            await retirement.retire();
            retirement.reopen();

            expect(await reactivateBoth()).toEqual([
                [INSTANCE_ID, LIVE_BYTES],
                [OTHER_INSTANCE_ID, OTHER_LIVE_BYTES],
            ]);
        });

        it('reads nothing and keeps the removal carry when the quiesce is cancelled before retirement', async () => {
            await activateBothAndEdit();
            await unloadPluginCarryingLiveState(OTHER_INSTANCE_ID);
            mocks.getPluginState.mockClear();

            const retirement = await beginProjectSessionPluginRetirement();
            retirement.reopen();

            expect(mocks.getPluginState).not.toHaveBeenCalled();
            expect(loadedExternalInstances.has(INSTANCE_ID)).toBe(true);
            await activate(SAVED_CHUNK, PLUGIN_ID, OTHER_INSTANCE_ID);
            expect(mocks.setPluginState.mock.calls).toEqual([[OTHER_INSTANCE_ID, OTHER_LIVE_BYTES]]);
            expect(warnings()).toEqual([]);
        });

        it('drops every carry, the removal carries included, when the session is released', async () => {
            await activateBothAndEdit();
            await unloadPluginCarryingLiveState(OTHER_INSTANCE_ID);

            const retirement = await beginProjectSessionPluginRetirement();
            await retirement.retire();
            retirement.release();

            expect(carriedExternalPluginStates.size).toBe(0);
            expect(await reactivateBoth()).toEqual([
                [INSTANCE_ID, SAVED_BYTES],
                [OTHER_INSTANCE_ID, SAVED_BYTES],
            ]);
        });

        it('warns by plugin name about an unreadable instance only when the quiesce is cancelled', async () => {
            await activateAndEdit(SAVED_CHUNK);
            mocks.getPluginState.mockRejectedValueOnce(new Error('control lock timed out'));

            const retirement = await beginProjectSessionPluginRetirement();
            await retirement.retire();
            expect(warnings()).toEqual([]);
            retirement.reopen();
            await activate(SAVED_CHUNK);

            expect(warnings()).toEqual([expect.stringContaining(PLUGIN_ID)]);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });

        it('says nothing about an unreadable instance when the session is released', async () => {
            await activateAndEdit(SAVED_CHUNK);
            mocks.getPluginState.mockRejectedValueOnce(new Error('control lock timed out'));

            const retirement = await beginProjectSessionPluginRetirement();
            await retirement.retire();
            retirement.release();
            retirement.reopen();

            expect(warnings()).toEqual([]);
        });

        it('completes the retirement at the read deadline and warns only on cancellation', async () => {
            await activateAndEdit(SAVED_CHUNK);
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            const lateRead = Promise.withResolvers<Uint8Array>();
            mocks.getPluginState.mockReturnValueOnce(lateRead.promise);

            const retirement = await beginProjectSessionPluginRetirement();
            const retiring = retirement.retire();
            await vi.advanceTimersByTimeAsync(5_000);
            await retiring;
            vi.useRealTimers();

            expect(mocks.unloadPlugin).toHaveBeenCalledWith(undefined);
            expect(warnings()).toEqual([]);
            lateRead.resolve(LIVE_BYTES);
            retirement.reopen();
            await activate(SAVED_CHUNK);
            expect(warnings()).toEqual([expect.stringContaining(PLUGIN_ID)]);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });
    });
});
