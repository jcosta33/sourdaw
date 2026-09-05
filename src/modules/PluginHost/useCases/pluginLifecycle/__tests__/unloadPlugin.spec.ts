import { beforeEach, describe, it, expect, vi } from 'vitest';

import { registerReleasedStripReportSink } from '../../../services/releasedStripReportSink';
import {
    defaultExternalPluginParameterState,
    externalPluginParameterStore,
} from '../../../stores/externalPluginParameterStore';
import { defaultPluginGuiState, pluginGuiStore } from '../../../stores/pluginGuiStore';
import { loadedExternalInstances } from '../loadedExternalInstances';
import * as subject from '../unloadPlugin';

type ReleasedStripReport = { kind: 'track' | 'bus'; id: string; deviceIds: readonly string[] };
type UnloadReply = { unloadedInstanceIds: string[]; errors: string[]; reports: ReleasedStripReport[] };

/** An unload reply naming no released strip, for tests unconcerned with reports. */
function reply(unloadedInstanceIds: string[], errors: string[]): UnloadReply {
    return { unloadedInstanceIds, errors, reports: [] };
}

const mocks = vi.hoisted(() => ({
    unloadRepo: vi.fn<(instanceId?: string) => Promise<UnloadReply>>(),
}));

/**
 * A repository call the test settles by hand, so the store can be read while
 * the unload is still in flight.
 */
function deferUnload(): { resolve: (result: UnloadReply) => void; reject: (error: Error) => void } {
    let settle = {} as { resolve: (result: UnloadReply) => void; reject: (error: Error) => void };
    mocks.unloadRepo.mockReturnValue(
        new Promise<UnloadReply>((resolve, reject) => {
            settle = { resolve, reject };
        })
    );
    return {
        resolve: (result) => settle.resolve(result),
        reject: (error) => settle.reject(error),
    };
}

/** Whether the store still mirrors an engine behind each named instance. */
function attachmentOf(...instanceIds: string[]): (boolean | undefined)[] {
    return instanceIds.map((id) => externalPluginParameterStore.value?.byInstanceId[id]?.engineAttached);
}

/** One parameter, so a retraction that dropped the list instead would show. */
const PARAMETER = {
    id: 7,
    name: 'Mix',
    value: 0.5,
    defaultValue: 0.5,
    minValue: 0,
    maxValue: 1,
    unit: '%',
    isAutomatable: true,
};

vi.mock('../../../repositories/pluginBridge/unloadPlugin', () => ({ unloadPlugin: mocks.unloadRepo }));

describe('unloadPlugin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pluginGuiStore.set(defaultPluginGuiState);
        externalPluginParameterStore.set(defaultExternalPluginParameterState);
        loadedExternalInstances.clear();
    });

    it('should export unloadPlugin', () => {
        expect(subject.unloadPlugin).toBeDefined();
        const time = typeof subject.unloadPlugin;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    /**
     * Unloading destroys the editor window outright — the OS never reports that
     * close, so the `plugin-gui-closed` event that retracts every other open
     * editor never arrives for this one. Left behind, the record says an
     * instance that no longer exists has an editor on screen, and it says so for
     * the rest of the session.
     */
    it('forgets the editor state of an instance it unloaded', async () => {
        pluginGuiStore.set({
            byInstanceId: { 'inst-1': { isOpen: true }, 'inst-2': { isOpen: true } },
        });
        mocks.unloadRepo.mockResolvedValue(reply(['inst-1'], []));

        await subject.unloadPlugin();

        expect(pluginGuiStore.value?.byInstanceId['inst-1']).toBeUndefined();
        // An instance the unload did not name keeps its editor.
        expect(pluginGuiStore.value?.byInstanceId['inst-2']).toEqual({ isOpen: true });
    });

    /**
     * The attach mirror decides whether a live strip may claim a native body for
     * an external plugin, and the native mapper refuses the *whole batch* over a
     * device whose instance it cannot find. The unload IPC is not instant, so a
     * play landing while it is in flight reads this store — and reads it after
     * the native side has already dropped the instance.
     */
    it('retracts the attachment before the unload is even awaited', async () => {
        externalPluginParameterStore.set({
            byInstanceId: {
                'inst-1': { engineAttached: true, parameters: [PARAMETER] },
                'inst-2': { engineAttached: true, parameters: [] },
            },
        });
        loadedExternalInstances.add('inst-1');
        let settle = (): void => undefined;
        mocks.unloadRepo.mockReturnValue(
            new Promise<UnloadReply>((resolve) => {
                settle = () => resolve(reply(['inst-1'], []));
            })
        );

        const unloading = subject.unloadPlugin('inst-1');
        await Promise.resolve();

        // In flight: the instance is no longer claimed as attached, and its
        // parameters are still there, because the plugin declared those and the
        // engine says nothing about them.
        expect(externalPluginParameterStore.value?.byInstanceId['inst-1']).toEqual({
            engineAttached: false,
            parameters: [PARAMETER],
        });
        // An instance this unload does not name keeps its own attachment.
        expect(externalPluginParameterStore.value?.byInstanceId['inst-2']?.engineAttached).toBe(true);

        settle();
        await unloading;

        // Once it lands the whole snapshot goes: parameters describing an
        // instance that no longer exists would offer automation for a
        // destroyed plugin.
        expect(externalPluginParameterStore.value?.byInstanceId['inst-1']).toBeUndefined();
    });

    it('retracts every attachment before an unkeyed unload is awaited', async () => {
        // The unkeyed unload names no instance because it retires all of them.
        externalPluginParameterStore.set({
            byInstanceId: {
                'inst-1': { engineAttached: true, parameters: [] },
                'inst-2': { engineAttached: true, parameters: [] },
            },
        });
        let settle = (): void => undefined;
        mocks.unloadRepo.mockReturnValue(
            new Promise<UnloadReply>((resolve) => {
                settle = () => resolve(reply([], []));
            })
        );

        const unloading = subject.unloadPlugin();
        await Promise.resolve();

        expect(
            Object.values(externalPluginParameterStore.value?.byInstanceId ?? {}).map(
                (snapshot) => snapshot.engineAttached
            )
        ).toEqual([false, false]);

        settle();
        await unloading;
    });

    /**
     * The retraction is optimistic, and an unload that fails keeps the instance
     * loaded *and* attached — the native `cancel_unload` leaves it in
     * `engine_plugins`. Nothing else ever sets the flag back: activation
     * short-circuits on an instance it already holds, and the engine reports
     * only the dormant instances a batch newly took. Left retracted, every
     * automation lane on that plugin stops riding the audible path and its
     * parameters leave the picker for the rest of the session.
     */
    it('restores the attachment of an instance the native side refused to unload', async () => {
        externalPluginParameterStore.set({
            byInstanceId: { 'inst-1': { engineAttached: true, parameters: [PARAMETER] } },
        });
        loadedExternalInstances.add('inst-1');
        const unload = deferUnload();

        const unloading = subject.unloadPlugin('inst-1');
        unload.resolve(reply([], ['inst-1: still processing']));

        await expect(unloading).rejects.toThrow('inst-1: still processing');
        // The instance is still loaded, so its snapshot stands and says so.
        expect(externalPluginParameterStore.value?.byInstanceId['inst-1']).toEqual({
            engineAttached: true,
            parameters: [PARAMETER],
        });
    });

    it('restores the attachment when the unload call itself rejects', async () => {
        externalPluginParameterStore.set({
            byInstanceId: { 'inst-1': { engineAttached: true, parameters: [PARAMETER] } },
        });
        loadedExternalInstances.add('inst-1');
        const unload = deferUnload();

        const unloading = subject.unloadPlugin('inst-1');
        unload.reject(new Error('desktop bridge unavailable'));

        await expect(unloading).rejects.toThrow('desktop bridge unavailable');
        expect(externalPluginParameterStore.value?.byInstanceId['inst-1']).toEqual({
            engineAttached: true,
            parameters: [PARAMETER],
        });
    });

    it('invents no attachment for an instance that had none before the failed unload', async () => {
        // Restoring from the *captured* set rather than from the failure is what
        // keeps this false: an instance loaded while no engine ran was never
        // attached, and claiming otherwise would offer automation the engine
        // never performs.
        externalPluginParameterStore.set({
            byInstanceId: { 'inst-1': { engineAttached: false, parameters: [PARAMETER] } },
        });
        loadedExternalInstances.add('inst-1');
        const unload = deferUnload();

        const unloading = subject.unloadPlugin('inst-1');
        unload.reject(new Error('desktop bridge unavailable'));

        await expect(unloading).rejects.toThrow('desktop bridge unavailable');
        expect(attachmentOf('inst-1')).toEqual([false]);
    });

    it('forgets what an unkeyed unload took and re-attaches what it did not', async () => {
        externalPluginParameterStore.set({
            byInstanceId: {
                'inst-1': { engineAttached: true, parameters: [] },
                'inst-2': { engineAttached: true, parameters: [PARAMETER] },
            },
        });
        const unload = deferUnload();

        const unloading = subject.unloadPlugin();
        unload.resolve(reply(['inst-1'], ['inst-2: still processing']));

        await expect(unloading).rejects.toThrow('inst-2: still processing');
        // The taken instance is gone outright, so the restore passes over it;
        // the refused one keeps the engine it never stopped having.
        expect(externalPluginParameterStore.value?.byInstanceId['inst-1']).toBeUndefined();
        expect(externalPluginParameterStore.value?.byInstanceId['inst-2']).toEqual({
            engineAttached: true,
            parameters: [PARAMETER],
        });
    });

    it('restores only the attachments an unkeyed unload actually retracted', async () => {
        // One failed rebuild unload must not hand every plugin in the session an
        // engine it never had.
        externalPluginParameterStore.set({
            byInstanceId: {
                'inst-1': { engineAttached: true, parameters: [] },
                'inst-2': { engineAttached: false, parameters: [] },
            },
        });
        const unload = deferUnload();

        const unloading = subject.unloadPlugin();
        unload.reject(new Error('desktop bridge unavailable'));

        await expect(unloading).rejects.toThrow('desktop bridge unavailable');
        expect(attachmentOf('inst-1', 'inst-2')).toEqual([true, false]);
    });

    /**
     * No test before this one in the file ever registers a sink, so the
     * module's slot is still the unset default it starts with — the one case
     * that actually exercises "no sink registered" rather than a stand-in for
     * it. Declared ahead of the next test so that one's registration cannot
     * leak backward into this one.
     */
    it('does not throw when a reply carrying reports has no sink registered', async () => {
        loadedExternalInstances.add('inst-1');
        mocks.unloadRepo.mockResolvedValue({
            unloadedInstanceIds: ['inst-1'],
            errors: [],
            reports: [{ kind: 'track', id: 'lead', deviceIds: ['comp'] }],
        });

        await expect(subject.unloadPlugin('inst-1')).resolves.toBeUndefined();
    });

    /**
     * The released-strip reports the native reply carries are this unload's
     * only route back to a foreign mirror of native chain state — there is no
     * batch of their own for a caller to read instead. Forwarding them once,
     * to whatever the composition root wired up, is what keeps that mirror
     * from going stale the moment an unload releases a chain entry.
     */
    it('forwards released strip reports to the registered sink', async () => {
        loadedExternalInstances.add('inst-1');
        const sink = vi.fn<(reports: readonly ReleasedStripReport[]) => void>();
        registerReleasedStripReportSink(sink);
        const reports: ReleasedStripReport[] = [{ kind: 'track', id: 'lead', deviceIds: ['comp', 'limiter'] }];
        mocks.unloadRepo.mockResolvedValue({ unloadedInstanceIds: ['inst-1'], errors: [], reports });

        await subject.unloadPlugin('inst-1');

        expect(sink).toHaveBeenCalledTimes(1);
        expect(sink).toHaveBeenCalledWith(reports);
    });
});
