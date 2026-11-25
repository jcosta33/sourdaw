import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyUser } from '#/utils/Notification/notifyUser';

import { onPluginServiceChanged } from '../../../repositories/pluginBridge/onPluginServiceChanged';
import { type PluginServiceChange } from '../../../repositories/pluginBridge/types';
import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
    type ExternalPluginActivationStatus,
} from '../../../stores/externalPluginActivationStore';
import { forgetPluginInstance } from '../forgetPluginInstance';
import { loadedExternalInstancePluginIds, loadedExternalInstances } from '../loadedExternalInstances';
import { watchExternalPluginService } from '../watchExternalPluginService';

vi.mock('../../../repositories/pluginBridge/onPluginServiceChanged', () => ({
    onPluginServiceChanged: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

const REASON = "'Reverb' refused to start processing; its blocks pass through unprocessed";
const MESSAGE = `vendor.reverb is out of service: ${REASON}.`;

/** The watcher holds one process-wide subscription, so it is started once and its handler kept. */
let push: (change: PluginServiceChange) => void = () => {};
let subscribeCalls = 0;

function slot(instanceId: string): ExternalPluginActivationStatus | undefined {
    return externalPluginActivationStore.value?.byInstanceId[instanceId];
}

function setSlot(instanceId: string, entry: ExternalPluginActivationStatus): void {
    externalPluginActivationStore.set({ byInstanceId: { [instanceId]: entry } });
}

function loadInstance(instanceId: string): void {
    loadedExternalInstances.add(instanceId);
    loadedExternalInstancePluginIds.set(instanceId, 'vendor.reverb');
    setSlot(instanceId, { status: 'active' });
}

describe('watchExternalPluginService', () => {
    beforeAll(() => {
        vi.mocked(onPluginServiceChanged).mockImplementation((handler) => {
            push = handler;
            return Promise.resolve(() => {});
        });
        watchExternalPluginService();
        watchExternalPluginService();
        subscribeCalls = vi.mocked(onPluginServiceChanged).mock.calls.length;
    });

    beforeEach(() => {
        vi.mocked(notifyUser).mockClear();
        for (const instanceId of [...loadedExternalInstances]) {
            forgetPluginInstance(instanceId);
        }
        externalPluginActivationStore.set(defaultExternalPluginActivationState);
    });

    it('keeps one subscription however many activations ask for it', () => {
        expect(subscribeCalls).toBe(1);
    });

    /// 'active' with a message is the slot's degraded rendering, which keeps the
    /// editor openable; 'error' would hide the editor the musician needs to undo
    /// the parameter that caused it.
    it('shows an instance out of service as an active slot carrying the reason, and tells the user', () => {
        loadInstance('inst-1');

        push({ instance_id: 'inst-1', out_of_service_reason: REASON });

        expect(slot('inst-1')).toEqual({ status: 'active', message: MESSAGE });
        expect(notifyUser).toHaveBeenCalledWith(MESSAGE, 'warning');
    });

    it('clears the slot when the instance is back in service', () => {
        loadInstance('inst-1');
        push({ instance_id: 'inst-1', out_of_service_reason: REASON });

        push({ instance_id: 'inst-1', out_of_service_reason: null });

        expect(slot('inst-1')).toEqual({ status: 'active' });
    });

    /// Another writer's entry (a failed restore, an unresponsive plugin) is not
    /// this watcher's to reset.
    it('leaves a slot something else rewrote when the instance comes back', () => {
        loadInstance('inst-1');
        push({ instance_id: 'inst-1', out_of_service_reason: REASON });
        setSlot('inst-1', { status: 'error', message: 'stopped responding' });

        push({ instance_id: 'inst-1', out_of_service_reason: null });

        expect(slot('inst-1')).toEqual({ status: 'error', message: 'stopped responding' });
    });

    it('ignores a change for an instance that is not loaded', () => {
        push({ instance_id: 'ghost', out_of_service_reason: REASON });

        expect(slot('ghost')).toBeUndefined();
        expect(notifyUser).not.toHaveBeenCalled();
    });

    /// A reused instance id must not inherit the message of the instance that
    /// held it before: a slot that happens to carry the same text is not cleared.
    it('forgets the remembered message when the instance is unloaded', () => {
        loadInstance('inst-1');
        push({ instance_id: 'inst-1', out_of_service_reason: REASON });

        forgetPluginInstance('inst-1');
        loadInstance('inst-1');
        setSlot('inst-1', { status: 'active', message: MESSAGE });
        push({ instance_id: 'inst-1', out_of_service_reason: null });

        expect(slot('inst-1')).toEqual({ status: 'active', message: MESSAGE });
    });
});
