import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPluginGuiState, pluginGuiStore } from '../../../stores/pluginGuiStore';
import { closePluginGui } from '../closePluginGui';
import { openPluginGui } from '../openPluginGui';

import type { PluginGuiClosed, PluginGuiInfo } from '../../../repositories/pluginBridge/types';

// Integration across the real open/close use cases down to the IPC repository
// boundary, which is mocked. What it pins is the editor's open state: the rack's
// control is a truthful toggle only if every way an editor can open or close —
// including the OS closing its window with nothing asking — leaves the same
// record behind.
const mocks = vi.hoisted(() => ({
    openGuiRepo: vi.fn<(instanceId: string) => Promise<PluginGuiInfo>>(),
    closeGuiRepo: vi.fn<(instanceId: string) => Promise<void>>(),
    subscribeGuiClosed: vi.fn<(handler: (closed: PluginGuiClosed) => void) => Promise<() => void>>(),
    warn: vi.fn(),
}));

vi.mock('../../../repositories/pluginBridge/openPluginGui', () => ({ openPluginGui: mocks.openGuiRepo }));
vi.mock('../../../repositories/pluginBridge/closePluginGui', () => ({ closePluginGui: mocks.closeGuiRepo }));
vi.mock('../../../repositories/pluginBridge/onPluginGuiClosed', () => ({
    onPluginGuiClosed: mocks.subscribeGuiClosed,
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: mocks.warn } }));

/**
 * The handler the single live subscription installed. Captured rather than
 * re-created per test because `watchPluginGuiClosed` keeps one process-wide
 * subscription, which the last test asserts.
 */
let reportGuiClosed: ((closed: PluginGuiClosed) => void) | null = null;

/**
 * Subscriptions started over the whole file, counted outside the mock so
 * `clearAllMocks` cannot reset it: the property under test is that one
 * subscription serves the process, which is only visible across tests.
 */
let subscriptionsStarted = 0;

const openedGui: PluginGuiInfo = { has_gui: true, is_open: true, width: 800, height: 600 };

describe('plugin editor open state', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pluginGuiStore.set(defaultPluginGuiState);
        mocks.openGuiRepo.mockResolvedValue(openedGui);
        mocks.closeGuiRepo.mockResolvedValue(undefined);
        mocks.subscribeGuiClosed.mockImplementation((handler) => {
            subscriptionsStarted++;
            reportGuiClosed = handler;
            return Promise.resolve(() => {});
        });
    });

    it('records an editor that opened, so the control can offer to close it', async () => {
        await openPluginGui('inst-1');

        expect(pluginGuiStore.value?.byInstanceId['inst-1']).toEqual({ isOpen: true });
    });

    it('records the editor closed once the app closes it', async () => {
        await openPluginGui('inst-1');

        await closePluginGui('inst-1');

        expect(mocks.closeGuiRepo).toHaveBeenCalledWith('inst-1');
        expect(pluginGuiStore.value?.byInstanceId['inst-1']).toEqual({ isOpen: false });
    });

    /**
     * The window belongs to the OS, and a title-bar close reaches this side only
     * as an event. Without it the control goes on offering to close a window
     * that is already gone, and the reopen it would then refuse.
     */
    it('records the editor closed when the OS ended its window', async () => {
        await openPluginGui('inst-1');
        expect(pluginGuiStore.value?.byInstanceId['inst-1']).toEqual({ isOpen: true });

        reportGuiClosed?.({ instance_id: 'inst-1' });

        expect(pluginGuiStore.value?.byInstanceId['inst-1']).toEqual({ isOpen: false });
    });

    it('leaves other instances alone when one editor is closed by the OS', async () => {
        await openPluginGui('inst-1');
        await openPluginGui('inst-2');

        reportGuiClosed?.({ instance_id: 'inst-1' });

        expect(pluginGuiStore.value?.byInstanceId['inst-2']).toEqual({ isOpen: true });
    });

    it('keeps the host refusal against the instance whose editor would not open', async () => {
        mocks.openGuiRepo.mockRejectedValue(new Error('Plugin GUI is already open'));

        await openPluginGui('inst-1');

        expect(pluginGuiStore.value?.byInstanceId['inst-1']).toEqual({
            isOpen: false,
            error: 'Plugin GUI is already open',
        });
    });

    /**
     * A close that failed left the window on screen. Recording it as closed
     * would leave a control offering to open an editor that is already up, and
     * the host refuses that with "already open".
     */
    it('keeps the editor open when the close was refused', async () => {
        await openPluginGui('inst-1');
        mocks.closeGuiRepo.mockRejectedValue(new Error('control path timed out'));

        await closePluginGui('inst-1');

        expect(pluginGuiStore.value?.byInstanceId['inst-1']).toEqual({
            isOpen: true,
            error: 'control path timed out',
        });
    });

    it('clears an earlier refusal once the editor does open', async () => {
        mocks.openGuiRepo.mockRejectedValueOnce(new Error('Plugin GUI is already open'));
        await openPluginGui('inst-1');

        await openPluginGui('inst-1');

        expect(pluginGuiStore.value?.byInstanceId['inst-1']).toEqual({ isOpen: true });
    });

    /**
     * The rack's control has no pending state, so a double-click issues two
     * calls against one window. Run concurrently they race: the close's IPC
     * answers while the open is still in flight, the open's record lands last,
     * and the store claims an editor is open that was just closed.
     */
    it('settles two overlapping editor calls in the order they were issued', async () => {
        const openArrival = Promise.withResolvers<PluginGuiInfo>();
        mocks.openGuiRepo.mockReturnValue(openArrival.promise);

        const opening = openPluginGui('inst-1');
        const closing = closePluginGui('inst-1');

        expect(mocks.closeGuiRepo).not.toHaveBeenCalled();

        openArrival.resolve(openedGui);
        await opening;
        await closing;

        expect(pluginGuiStore.value?.byInstanceId['inst-1']).toEqual({ isOpen: false });
    });

    it('subscribes to OS-initiated closes exactly once however many editors open', async () => {
        await openPluginGui('inst-1');
        await openPluginGui('inst-2');
        await openPluginGui('inst-3');

        expect(subscriptionsStarted).toBe(1);
    });
});
