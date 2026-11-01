import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import {
    compileLoadPresetActions,
    getArrangementHandlers,
    setArrangementEventBus,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeUserAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { compileToasterTrackStackActions } from '#/modules/Toaster/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { executePresetLoad } from '../executePresetLoad';

// The Web Audio graph is the boundary: these specs observe project truth and
// history, so the live strip a preset load initializes is reported as built.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getTrackStrip: () => undefined,
    initializeTrackStripFromSnapshot: () => ({
        acceptance: 'accepted',
        application: 'applied',
        correlation: { appRevision: 1, projectRevision: 'project' },
        runtimeRevision: 1,
    }),
    updateDeviceParam: () => undefined,
}));

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

type TrackRow = { id: string; kind: string; parentId?: string; devices: { id: string; type: string }[] };
type ProjectDocument = { tracks?: { tracks?: TrackRow[] } };

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function storeTracks(): readonly TrackRow[] {
    return trackStore.value?.tracks ?? [];
}

function documentTracks(): readonly TrackRow[] {
    return getCrdtDoc<ProjectDocument>('root')?.tracks?.tracks ?? [];
}

function undoUnitCount(): number {
    const past = undoHistoryStore.value?.past ?? [];
    return past.filter((entry, index) => !entry.groupId || past[index + 1]?.groupId !== entry.groupId).length;
}

function compilePresetOnNewTrack(presetId: string) {
    const plan = compileLoadPresetActions({ presetId });
    if (!plan) {
        throw new Error(`Expected preset ${presetId} to compile onto a new track`);
    }
    return plan;
}

/**
 * The instrument and preset cards of the Instruments browser create a track
 * when none is selected: `executePresetLoad` commits the compiled
 * `addTrack` + `loadPreset` (+ Toaster pads) batch as one history group. The
 * real Arrangement handlers, Automerge authority and undo machinery run, so
 * the group's recorded inverses are the ones a person's Undo replays.
 */
describe('executePresetLoad undo on an empty project', () => {
    let notifications: NotifyPayload[] = [];
    let unsubscribeFromNotifications: () => void = () => undefined;

    beforeEach(() => {
        Container.clear();
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);
        setArrangementEventBus({ emit: () => Promise.resolve() });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('preset load undo integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        unsubscribeFromNotifications();
        unsubscribeFromNotifications = () => undefined;
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each([
        ['instrument card', 'fermenter-default', 'fermenter'],
        ['preset card', 'synth-arp-crystal', 'builtin-synth'],
    ])(
        'undoes the %s load that created its track in one step, redoes it, and undoes it again',
        async (_card, presetId, deviceType) => {
            const plan = compilePresetOnNewTrack(presetId);

            await executePresetLoad(plan);
            flushAutomergeStorageWrites();

            expect(storeTracks().map((track) => track.id)).toEqual([plan.trackId]);
            expect(storeTracks()[0]?.devices.map((device) => device.id)).toEqual(plan.deviceIds);
            expect(storeTracks()[0]?.devices[0]?.type).toBe(deviceType);
            expect(documentTracks().map((track) => track.id)).toEqual([plan.trackId]);
            expect(undoUnitCount()).toBe(1);

            await undo();
            flushAutomergeStorageWrites();

            expect(notifications).toEqual([]);
            expect(storeTracks()).toEqual([]);
            expect(documentTracks()).toEqual([]);
            expect(undoHistoryStore.value?.past ?? []).toEqual([]);
            expect(undoHistoryStore.value?.future.length).toBeGreaterThan(0);

            await redo();
            flushAutomergeStorageWrites();

            expect(notifications).toEqual([]);
            expect(storeTracks().map((track) => track.id)).toEqual([plan.trackId]);
            expect(storeTracks()[0]?.devices.map((device) => device.id)).toEqual(plan.deviceIds);
            expect(documentTracks()[0]?.devices.map((device) => device.id)).toEqual(plan.deviceIds);
            expect(undoUnitCount()).toBe(1);

            await undo();
            flushAutomergeStorageWrites();

            expect(notifications).toEqual([]);
            expect(storeTracks()).toEqual([]);
            expect(documentTracks()).toEqual([]);
        }
    );

    it('undoes a whole Toaster kit, folder and pads, as one step and redoes it', async () => {
        const plan = compileToasterTrackStackActions();
        if (!plan) {
            throw new Error('Expected the Toaster kit to compile on an empty project');
        }

        await executePresetLoad(plan);
        flushAutomergeStorageWrites();

        expect(storeTracks()).toHaveLength(17);
        expect(storeTracks().filter((track) => track.parentId === plan.trackId)).toHaveLength(16);
        expect(
            storeTracks()
                .find((track) => track.id === plan.trackId)
                ?.devices.map((device) => device.id)
        ).toEqual(plan.deviceIds);
        expect(undoUnitCount()).toBe(1);

        await undo();
        flushAutomergeStorageWrites();

        expect(notifications).toEqual([]);
        expect(storeTracks()).toEqual([]);
        expect(documentTracks()).toEqual([]);
        expect(undoHistoryStore.value?.past ?? []).toEqual([]);

        await redo();
        flushAutomergeStorageWrites();

        expect(notifications).toEqual([]);
        expect(storeTracks()).toHaveLength(17);
        expect(documentTracks()).toHaveLength(17);

        await undo();
        flushAutomergeStorageWrites();

        expect(notifications).toEqual([]);
        expect(storeTracks()).toEqual([]);
    });

    it('keeps a plain MIDI track add undoable', async () => {
        await executeUserAppAction({ type: 'addTrack', payload: { name: 'MIDI', kind: 'midi' } });
        flushAutomergeStorageWrites();
        expect(storeTracks()).toHaveLength(1);

        await undo();
        flushAutomergeStorageWrites();

        expect(notifications).toEqual([]);
        expect(storeTracks()).toEqual([]);
        expect(documentTracks()).toEqual([]);
    });

    it('keeps a preset that replaces an existing track instrument undoable', async () => {
        await executeUserAppAction({ type: 'addTrack', payload: { name: 'MIDI', kind: 'midi' } });
        flushAutomergeStorageWrites();
        const [created] = storeTracks();
        if (!created) {
            throw new Error('Expected the MIDI track');
        }
        const originalDeviceIds = created.devices.map((device) => device.id);
        const plan = compileLoadPresetActions({ presetId: 'synth-arp-crystal', trackId: created.id });
        if (!plan) {
            throw new Error('Expected the preset to compile onto the existing track');
        }

        await executePresetLoad(plan);
        flushAutomergeStorageWrites();
        expect(storeTracks()[0]?.devices.map((device) => device.id)).toEqual(plan.deviceIds);

        await undo();
        flushAutomergeStorageWrites();

        expect(notifications).toEqual([]);
        expect(storeTracks().map((track) => track.id)).toEqual([created.id]);
        expect(storeTracks()[0]?.devices.map((device) => device.id)).toEqual(originalDeviceIds);
        expect(documentTracks()[0]?.devices.map((device) => device.id)).toEqual(originalDeviceIds);
    });
});
