import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { type PluginInstance } from '../../../repositories/pluginBridge/types';
import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../../stores/externalPluginActivationStore';
import { activateExternalPlugin } from '../activateExternalPlugin';
import { beginProjectSessionPluginRetirement } from '../beginProjectSessionPluginRetirement';
import { carriedExternalPluginStates } from '../carriedExternalPluginStates';
import { clearLoadedExternalPlugins } from '../clearLoadedExternalPlugins';
import { forgetRetiredPluginInstances } from '../forgetRetiredPluginInstances';
import { loadedExternalInstances } from '../loadedExternalInstances';
import { markExternalPluginRestoreFailure } from '../markExternalPluginRestoreFailure';
import { readExternalPluginStatesBeforeEngineRetire } from '../readExternalPluginStatesBeforeEngineRetire';
import { resetExternalPluginRuntimeForGraphRebuild } from '../resetExternalPluginRuntimeForGraphRebuild';
import { restorePluginState } from '../restorePluginState';
import { unloadPlugin } from '../unloadPlugin';
import { unloadPluginCarryingLiveState } from '../unloadPluginCarryingLiveState';

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

        it('does not revive a carry the plugin rejected, and warns only once', async () => {
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
            expect(warnings()).toEqual([expect.stringContaining(PLUGIN_ID)]);
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

        it('restores the project chunk after the project session retires', async () => {
            await activateAndEdit(SAVED_CHUNK);
            await unloadPluginCarryingLiveState(INSTANCE_ID);

            const retirement = await beginProjectSessionPluginRetirement();
            await retirement.retire();
            retirement.reopen();
            await activate(SAVED_CHUNK);

            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
        });
    });
});
