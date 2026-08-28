import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type PluginParameterEvents } from '../../../repositories/pluginBridge/types';

vi.mock('../../../repositories/pluginBridge/onPluginParameterEvents', () => ({
    onPluginParameterEvents: vi.fn(),
}));

type PushBatch = (batch: PluginParameterEvents) => void;

/**
 * Load a fresh copy of the use case and hand back the push the native bridge
 * would make.
 *
 * The module holds one process-wide subscription on purpose — the native event
 * is a broadcast — so a second test running against the first test's listener
 * would observe edits it never pushed. Resetting the registry is the only way to
 * give each test its own.
 */
async function freshWatcher(): Promise<{
    push: PushBatch;
    observe: (typeof import('../observeExternalPluginParameterEdits'))['observeExternalPluginParameterEdits'];
    start: (typeof import('../watchExternalPluginParameterEvents'))['watchExternalPluginParameterEvents'];
    store: typeof import('../../../stores/externalPluginParameterStore');
    unlisten: ReturnType<typeof vi.fn>;
    subscribeCalls: () => number;
}> {
    vi.resetModules();
    const { onPluginParameterEvents } = await import('../../../repositories/pluginBridge/onPluginParameterEvents');
    const unlisten = vi.fn();
    let push: PushBatch = () => {};
    vi.mocked(onPluginParameterEvents).mockReset();
    vi.mocked(onPluginParameterEvents).mockImplementation((handler) => {
        push = handler;
        return Promise.resolve(unlisten);
    });

    const watcher = await import('../watchExternalPluginParameterEvents');
    const seam = await import('../observeExternalPluginParameterEdits');
    const store = await import('../../../stores/externalPluginParameterStore');
    store.externalPluginParameterStore.set(store.defaultExternalPluginParameterState);

    return {
        push: (batch) => {
            push(batch);
        },
        observe: seam.observeExternalPluginParameterEdits,
        start: watcher.watchExternalPluginParameterEvents,
        store,
        unlisten,
        subscribeCalls: () => vi.mocked(onPluginParameterEvents).mock.calls.length,
    };
}

function snapshot(store: Awaited<ReturnType<typeof freshWatcher>>['store'], instanceId: string): void {
    store.writeExternalPluginParameterSnapshot(instanceId, {
        engineAttached: true,
        parameters: [
            {
                id: 12,
                name: 'Cutoff',
                value: 0.1,
                defaultValue: 0.1,
                minValue: 0,
                maxValue: 1,
                unit: 'Hz',
                isAutomatable: true,
            },
        ],
    });
}

describe('watchExternalPluginParameterEvents', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("moves the host's view of the parameter to the value the plugin reported", async () => {
        const watcher = await freshWatcher();
        snapshot(watcher.store, 'inst-1');
        watcher.start();

        watcher.push({ instance_id: 'inst-1', events: [{ param_id: 12, kind: 'value', value: 0.75 }] });

        expect(watcher.store.externalPluginParameterStore.value?.byInstanceId['inst-1']?.parameters).toEqual([
            expect.objectContaining({ id: 12, value: 0.75 }),
        ]);
    });

    /// A value edit says what the control is set to and nothing about its
    /// contract; overwriting the rest would describe a declaration the plugin
    /// never made.
    it('leaves the rest of the parameter contract exactly as the plugin declared it', async () => {
        const watcher = await freshWatcher();
        snapshot(watcher.store, 'inst-1');
        watcher.start();

        watcher.push({ instance_id: 'inst-1', events: [{ param_id: 12, kind: 'value', value: 0.75 }] });

        expect(watcher.store.externalPluginParameterStore.value?.byInstanceId['inst-1']?.parameters[0]).toEqual({
            id: 12,
            name: 'Cutoff',
            value: 0.75,
            defaultValue: 0.1,
            minValue: 0,
            maxValue: 1,
            unit: 'Hz',
            isAutomatable: true,
        });
    });

    it('ignores a parameter no snapshot declares rather than inventing one', async () => {
        const watcher = await freshWatcher();
        snapshot(watcher.store, 'inst-1');
        watcher.start();

        watcher.push({ instance_id: 'inst-1', events: [{ param_id: 999, kind: 'value', value: 0.5 }] });

        expect(watcher.store.externalPluginParameterStore.value?.byInstanceId['inst-1']?.parameters).toEqual([
            expect.objectContaining({ id: 12, value: 0.1 }),
        ]);
    });

    it('ignores an instance no snapshot declares rather than creating one', async () => {
        const watcher = await freshWatcher();
        watcher.start();

        watcher.push({ instance_id: 'inst-unknown', events: [{ param_id: 1, kind: 'value', value: 0.5 }] });

        expect(watcher.store.externalPluginParameterStore.value?.byInstanceId['inst-unknown']).toBeUndefined();
    });

    /// The bracketing is the whole point of the seam: without it a recorder in
    /// touch mode cannot tell a held ride from a run of separate nudges.
    it('hands an observer the whole ride, bracketed, in the order the plugin produced it', async () => {
        const watcher = await freshWatcher();
        snapshot(watcher.store, 'inst-1');
        const seen: unknown[] = [];
        watcher.observe((edit) => seen.push(edit));

        watcher.push({
            instance_id: 'inst-1',
            events: [
                { param_id: 12, kind: 'gesture_begin' },
                { param_id: 12, kind: 'value', value: 0.2 },
                { param_id: 12, kind: 'value', value: 0.6 },
                { param_id: 12, kind: 'gesture_end' },
            ],
        });

        expect(seen).toEqual([
            { instanceId: 'inst-1', parameterId: 12, kind: 'gestureBegin' },
            { instanceId: 'inst-1', parameterId: 12, kind: 'value', value: 0.2 },
            { instanceId: 'inst-1', parameterId: 12, kind: 'value', value: 0.6 },
            { instanceId: 'inst-1', parameterId: 12, kind: 'gestureEnd' },
        ]);
    });

    it('stops handing edits to an observer that unsubscribed', async () => {
        const watcher = await freshWatcher();
        snapshot(watcher.store, 'inst-1');
        const seen: unknown[] = [];
        const stop = watcher.observe((edit) => seen.push(edit));

        stop();
        watcher.push({ instance_id: 'inst-1', events: [{ param_id: 12, kind: 'value', value: 0.4 }] });

        expect(seen).toEqual([]);
    });

    /// The native event is a broadcast. A second subscription would hand every
    /// observer every edit twice, and the project would mark itself dirty twice
    /// for one knob.
    it('keeps one subscription however many callers ask for it', async () => {
        const watcher = await freshWatcher();
        watcher.start();
        watcher.observe(() => {});
        watcher.observe(() => {});
        watcher.start();

        expect(watcher.subscribeCalls()).toBe(1);
    });
});
