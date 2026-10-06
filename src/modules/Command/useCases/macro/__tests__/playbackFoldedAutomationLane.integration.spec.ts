import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, markerStore } from '#/modules/Arrangement/stores';
import { createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { addAutomationLane } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
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

import { type Macro } from '../../../models/Macro';
import { playMacro } from '../playback';

// The lane fold (#4962 review): a replayed addAutomationLane whose track
// already owns a track-level lane for the parameter is dropped by the handler's
// noop gate, so the pre-minted lane id materializes no lane. Playback must map
// the recorded lane id onto the lane the track actually owns — the same
// resolution the fold predicate uses — or every later lane-referencing step
// addresses a phantom. These rows drive the exact recorded macro through the
// real handler registry, real dispatch and real stores.

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

type ArrangementTrackEvents = {
    'track.added': { trackId: string; name: string; kind: string };
    'track.removed': { trackId: string };
    'track.selectionChanged': { trackId: string | null; previousTrackId: string | null };
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const FOLD_MACRO_ID = 'fold-replay-1';

function foldMacro(): Macro {
    return {
        id: FOLD_MACRO_ID,
        name: 'Fold replay',
        actions: [
            {
                type: 'addAutomationLane',
                payload: {
                    trackId: 't-a',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    laneId: 'recorded-lane',
                },
            },
            {
                type: 'addAutomationPoint',
                payload: { laneId: 'recorded-lane', pointId: 'recorded-point', beat: 4, value: 0.5 },
            },
        ],
        createdAt: 0,
    };
}

function gainLane(): { id: string; points: readonly { beat: number }[] } {
    const lane = automationStore.value?.lanes.find((candidate) => !candidate.clipId);
    expect(lane).toBeDefined();
    return { id: lane!.id, points: lane!.points };
}

describe('playMacro with a folded addAutomationLane', () => {
    let unsubscribeFromNotifications: () => void = () => undefined;

    beforeEach(() => {
        Container.clear();
        const notificationEventBus = createEventBus<NotificationEvents>();
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', () => undefined);
        setNotificationEventBus(notificationEventBus);
        setArrangementEventBus(createEventBus<ArrangementTrackEvents>());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('fold replay integration');
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
            tracks: [createTrack({ id: 't-a', name: 'Vox', kind: 'audio' })],
            selectedTrackId: 't-a',
        });
        // The lane the recording folded into: present before the replay, owned
        // by the track, carrying no points yet.
        addAutomationLane('t-a', 'gain', 'Gain', 'existing-lane');
        macroStore.set({ macros: [foldMacro()], recording: false, currentRecording: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setTrackStoreState(structuredClone(defaultTrackState));
        markerStore.set({ markers: [], sections: [] });
        automationStore.set({ lanes: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        unsubscribeFromNotifications();
        unsubscribeFromNotifications = () => undefined;
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        localStorage.removeItem('sourdaw:macros');
    });

    it('lands the replayed point on the track-level lane the fold folded into', async () => {
        await playMacro(FOLD_MACRO_ID);

        const lane = gainLane();
        expect(lane.id).toBe('existing-lane');
        expect(automationStore.value?.lanes).toHaveLength(1);
        expect(lane.points.map((point) => point.beat)).toEqual([4]);
    });

    it('lands the replayed point on the track-level lane even when a clip-scoped lane for the same parameter is listed first', async () => {
        const trackLevelLane = automationStore.value?.lanes[0];
        if (!trackLevelLane) {
            throw new Error('expected the folded track-level lane to exist');
        }
        // The review's constructed mixup: a clip-scoped gain lane on the same
        // track, listed before the fold target. The fold resolution must skip
        // it explicitly, or the replayed point is redirected onto the clip.
        automationStore.set({
            lanes: [{ ...trackLevelLane, id: 'clip-gain-lane', clipId: 'clip-1' }, trackLevelLane],
        });

        await playMacro(FOLD_MACRO_ID);

        expect(automationStore.value?.lanes.find((lane) => lane.id === 'clip-gain-lane')?.points).toHaveLength(0);
        const lane = gainLane();
        expect(lane.id).toBe('existing-lane');
        expect(lane.points.map((point) => point.beat)).toEqual([4]);
    });

    it('lands the point on each play of a replay-twice flow with an undo between', async () => {
        await playMacro(FOLD_MACRO_ID);
        expect(gainLane().points.map((point) => point.beat)).toEqual([4]);

        await undo();
        const laneAfterUndo = gainLane();
        expect(laneAfterUndo.id).toBe('existing-lane');
        expect(laneAfterUndo.points).toHaveLength(0);

        await playMacro(FOLD_MACRO_ID);
        const laneAfterSecondPlay = gainLane();
        expect(laneAfterSecondPlay.id).toBe('existing-lane');
        expect(laneAfterSecondPlay.points.map((point) => point.beat)).toEqual([4]);
    });
});
