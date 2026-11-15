import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { readExternalPluginStatesBeforeEngineRetire } from '../readExternalPluginStatesBeforeEngineRetire';
import { resetExternalPluginRuntimeForGraphRebuild } from '../resetExternalPluginRuntimeForGraphRebuild';
import { unloadPlugin, unloadPluginCarryingLiveState } from '../unloadPlugin';

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

function pluginInstance(): PluginInstance {
    return {
        instance_id: INSTANCE_ID,
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

function activate(stateChunk: string | undefined, pluginId = PLUGIN_ID) {
    return activateExternalPlugin({ pluginId, instanceId: INSTANCE_ID, stateChunk });
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
        mocks.loadPlugin.mockResolvedValue(pluginInstance());
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
            // The read holds the instance's lifecycle turn until it answers; its
            // answer, arriving after the deadline, must carry nothing.
            lateRead.resolve(LIVE_BYTES);
            await activate(SAVED_CHUNK);

            expect(warnings()).toEqual([expect.stringContaining(PLUGIN_ID)]);
            expect(mocks.setPluginState.mock.calls).toEqual([[INSTANCE_ID, SAVED_BYTES]]);
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
