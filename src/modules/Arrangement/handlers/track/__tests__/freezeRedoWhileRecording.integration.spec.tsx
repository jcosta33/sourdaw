import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory,
    createCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { recordingStartStore } from '#/modules/Transport/stores';
import {
    setNotificationEventBus,
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
} from '#/utils/Notification/notificationEventBus';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { activeFreezeTasks } from '../../../useCases/freezeBounce/freezeTrack';
import { type renderTrackOffline } from '../../../useCases/freezeBounce/renderOffline';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

const render = vi.hoisted(() => vi.fn<typeof renderTrackOffline>());
vi.mock('../../../useCases/freezeBounce/renderOffline', () => ({ renderTrackOffline: render }));

const WARNING = 'Freeze is unavailable while this track is recording.';

function buffer(): AudioBuffer {
    const samples = new Float32Array(128).fill(0.5);
    return {
        duration: samples.length / 48000,
        length: samples.length,
        numberOfChannels: 1,
        sampleRate: 48000,
        getChannelData: () => samples,
        copyFromChannel: (destination) => {
            destination.set(samples.subarray(0, destination.length));
        },
        copyToChannel: (source) => {
            samples.set(source.subarray(0, samples.length));
        },
    };
}

function freezeStatus(): string | undefined {
    return trackStore.value?.tracks[0]?.freezeState.status;
}

describe('Freeze history replay while a recording starts', () => {
    let notices: NotifyPayload[];

    beforeEach(async () => {
        notices = [];
        const bus = createEventBus<{
            'ui.notify': NotifyPayload;
            'ui.confirm': ConfirmPayload;
            'ui.prompt': PromptPayload;
        }>();
        bus.on('ui.notify', (notice) => {
            notices.push(notice);
        });
        setNotificationEventBus(bus);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Freeze redo while recording');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        activeFreezeTasks.clear();
        actionHistoryStore.set({ entries: [] });
        macroStore.set({ macros: [], recording: true, currentRecording: [] });
        projectStore.set({ ...defaultProjectStoreState, createdAt: 100, updatedAt: 100, loading: false });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'freeze-track', armed: true })],
            selectedTrackId: 'freeze-track',
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        render.mockReset();
        render.mockResolvedValue(buffer());
        recordingStartStore.set(false);
        await executeAppAction({ type: 'freezeTrack', payload: { trackId: 'freeze-track' } });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        recordingStartStore.set(false);
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        clearHandlerRegistry();
        activeFreezeTasks.clear();
    });

    it('refuses the redo of a freeze during count-in, keeps the entry redoable, and redoes it once recording stops', async () => {
        await undo();
        expect(freezeStatus()).toBe('unfrozen');
        recordingStartStore.set(true);

        await redo();

        expect(freezeStatus()).toBe('unfrozen');
        expect(notices).toContainEqual({ message: WARNING, level: 'warning' });
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);

        recordingStartStore.set(false);
        await redo();

        expect(freezeStatus()).toBe('frozen');
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
        expect(render).toHaveBeenCalledTimes(1);
    });

    it('refuses the undo of an unfreeze during count-in, keeps the entry undoable, and undoes it once recording stops', async () => {
        await executeAppAction({ type: 'unfreezeTrack', payload: { trackId: 'freeze-track' } });
        expect(freezeStatus()).toBe('unfrozen');
        expect(undoStore.value?.past).toHaveLength(2);
        recordingStartStore.set(true);

        await undo();

        expect(freezeStatus()).toBe('unfrozen');
        expect(notices).toContainEqual({ message: WARNING, level: 'warning' });
        expect(undoStore.value?.past).toHaveLength(2);
        expect(undoStore.value?.future).toHaveLength(0);

        recordingStartStore.set(false);
        await undo();

        expect(freezeStatus()).toBe('frozen');
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(1);
    });

    it('still undoes a freeze during count-in, since unfreezing is always allowed', async () => {
        recordingStartStore.set(true);

        await undo();

        expect(freezeStatus()).toBe('unfrozen');
        expect(notices).not.toContainEqual({ message: WARNING, level: 'warning' });
    });
});
