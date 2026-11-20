import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, markerStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    registerProductionCommandHandlers,
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
import { midiStore } from '#/modules/MIDI/stores';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { type Modulator } from '../../../models/Modulator';
import { modulationStore, type ModulationStoreState } from '../../../stores/modulationStore';

// Audit #4591 — the Modulation Matrix removes, adds, renames and toggles
// modulators and mappings by calling these use cases directly. None of them
// records history, so Undo skips the edit and reverts the one before it.
// Real production handlers, stores, dispatch and undo machinery.
//
// (This case originally called the bare `removeModulator` use case the panel
// still called; the action exists now, so it dispatches what the panel
// dispatches, like the routed cases in the timeline spec.)

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

type ArrangementTrackEvents = {
    'track.removed': { trackId: string };
    'track.selectionChanged': { trackId: string | null; previousTrackId: string | null };
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

describe('Modulation Matrix edits and Undo', () => {
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
        setArrangementEventBus(createEventBus<ArrangementTrackEvents>());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('modulation matrix undo integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        automationStore.set({ lanes: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        markerStore.set({ markers: [], sections: [] });
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [
                createTrack({ id: 't-drums', name: 'Drums', kind: 'midi' }),
                createTrack({ id: 't-bass', name: 'Bass', kind: 'midi' }),
            ],
            selectedTrackId: 't-drums',
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setTrackStoreState(structuredClone(defaultTrackState));
        markerStore.set({ markers: [], sections: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        unsubscribeFromNotifications();
        unsubscribeFromNotifications = () => undefined;
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each(['lfo-1', 'absent-source'])(
        'preserves both history stacks when adding an unchanged mapping to %s',
        async (modulatorId) => {
            const first: Modulator = {
                id: 'lfo-1',
                name: 'Wobble',
                trackId: 't-drums',
                kind: 'lfo',
                config: { kind: 'lfo', waveform: 'triangle', rate: 2, sync: true, phase: 0, depth: 1 },
                mappings: [
                    {
                        targetTrackId: 't-drums',
                        targetDeviceId: 'device-filter',
                        targetParamId: 'cutoff',
                        amount: -0.37,
                    },
                ],
                enabled: true,
            };
            const second: Modulator = {
                id: 'step-2',
                name: 'Pulse',
                trackId: 't-bass',
                kind: 'step',
                config: { kind: 'step', steps: [0, 1, 0.25], rate: 1, smooth: 0 },
                mappings: [],
                enabled: true,
            };
            const expectSources = (...modulators: Modulator[]) => {
                flushAutomergeStorageWrites();
                const root = getCrdtDoc<{ modulation: ModulationStoreState }>('root');
                if (!root) {
                    throw new Error('Expected a live project document');
                }
                expect(Automerge.toJS(root).modulation).toEqual({ modulators });
                expect(modulationStore.value).toEqual({ modulators });
            };
            const unmapped = { ...first, mappings: [] };
            modulationStore.set({ modulators: [unmapped] });
            await executeAppAction({
                type: 'addMapping',
                payload: { modulatorId: first.id, mapping: first.mappings[0]! },
            });
            expectSources(first);
            const mappingEntry = undoHistoryStore.value?.past.at(-1);
            const { id, ...source } = second;
            await executeAppAction({ type: 'addModulator', payload: { modulatorId: id, modulator: source } });
            expectSources(first, second);
            const sourceEntry = undoHistoryStore.value?.past.at(-1);
            await undo();
            expectSources(first);
            expect(undoHistoryStore.value).toEqual({ past: [mappingEntry], future: [sourceEntry] });
            const heads = Automerge.getHeads(getCrdtDoc('root')!);

            await executeAppAction({
                type: 'addMapping',
                payload: { modulatorId, mapping: { ...first.mappings[0]!, amount: 0.5 } },
            });
            expectSources(first);
            expect(undoHistoryStore.value).toEqual({ past: [mappingEntry], future: [sourceEntry] });
            expect(Automerge.getHeads(getCrdtDoc('root')!)).toEqual(heads);
            await redo();
            expectSources(first, second);
            await undo();
            await undo();
            expectSources(unmapped);
            await redo();
            expectSources(first);
        }
    );

    it('undoes a modulator removed from the Modulation Matrix', async () => {
        modulationStore.set({
            modulators: [
                {
                    id: 'lfo-1',
                    name: 'Filter wobble',
                    trackId: 't-drums',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: true, phase: 0, depth: 1 },
                    mappings: [],
                    enabled: true,
                },
            ],
        });
        await executeAppAction({ type: 'setTrackColor', payload: { trackId: 't-drums', color: '#222222' } });

        await executeAppAction({ type: 'removeModulator', payload: { modulatorId: 'lfo-1' } });
        await undo();

        expect.soft(modulationStore.value?.modulators.map((modulator) => modulator.id)).toEqual(['lfo-1']);
        expect.soft(trackStore.value?.tracks.find((track) => track.id === 't-drums')?.color).toBe('#222222');
    });
});
