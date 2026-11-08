import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
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
    getCrdtDoc,
    markActionHistoryEntryReverted,
    projectCrdtToStores,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDocInLineage,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { type AutomationLane, type AutomationPoint } from '../../../models/Automation';
import { automationStore, type AutomationStoreState } from '../../../stores/automationStore';
import { getAutomationHandlers } from '../../getAutomationHandlers';
import { recordAutomationValue } from '../recordAutomationValue';
import { setAutomationRecordingDependencies } from '../recordingDependencies';
import { startAutomationRecording } from '../startAutomationRecording';
import { stopAutomationRecording } from '../stopAutomationRecording';

type Root = { automation: AutomationStoreState; tracks: Pick<TrackStoreState, 'tracks'> };
type Notifications = { 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload };

const gainBefore: AutomationPoint[] = [
    { id: 'gain-origin', beat: 0, value: 0.11, curve: 'linear', tension: 0 },
    { id: 'gain-before-ride', beat: 1.25, value: 0.22, curve: 'step', tension: 0 },
    {
        id: 'gain-tail',
        beat: 8,
        value: 0.77,
        curve: 'bezier',
        tension: 0.3,
        cp1: { x: 0.2, y: 0.8 },
        cp2: { x: 0.7, y: 0.1 },
    },
];
const panBefore: AutomationPoint[] = [
    { id: 'pan-origin', beat: 0, value: -0.2, curve: 'linear', tension: 0 },
    { id: 'pan-before-ride', beat: 1.25, value: 0.1, curve: 'linear', tension: 0 },
    { id: 'pan-tail', beat: 8, value: 0.3, curve: 'stairs', tension: -0.4, stairSteps: 3 },
];

function lane(id: string, parameterId: string, points: AutomationPoint[]): AutomationLane {
    return {
        id,
        trackId: 'recording-track',
        parameterId,
        parameterName: parameterId,
        points,
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: -1,
        maxValue: 1,
        color: '#314159',
    };
}

const initialLanes = [
    lane('gain-lane', 'gain', gainBefore),
    lane('pan-lane', 'pan', panBefore),
    {
        ...lane('keeper-lane', 'gain', [{ id: 'keeper', beat: 6, value: 0.64, curve: 'step', tension: 0 }]),
        trackId: 'keeper-track',
    },
];

function root() {
    const document = getCrdtDoc<Root>('root');
    if (!document) {
        throw new Error('Expected recording authority');
    }
    return document;
}

function material() {
    flushAutomergeStorageWrites();
    const raw = Automerge.toJS(root());
    expect(raw.automation).toEqual(structuredClone(automationStore.value));
    expect(raw.tracks.tracks).toEqual(structuredClone(trackStore.value?.tracks));
    return raw;
}

function mergePeer(change: Automerge.ChangeFn<Root>) {
    flushAutomergeStorageWrites();
    const current = root();
    const peer = Automerge.change(Automerge.clone(current), change);
    replaceCrdtDocInLineage({ id: 'root', doc: Automerge.merge(Automerge.clone(current), peer) });
    projectCrdtToStores();
    return material();
}

function peerEdit(draft: Root, laneId: string) {
    const target = draft.automation.lanes.find((candidate) => candidate.id === laneId);
    if (!target) {
        throw new Error('Expected the peer target lane');
    }
    target.points.push({
        id: 'peer-tail',
        beat: 9.25,
        value: 0.93,
        curve: 'bezier',
        tension: -0.6,
        cp1: { x: 0.1, y: 0.9 },
        cp2: { x: 0.8, y: 0.2 },
    });
    target.points[0]!.curve = 'stairs';
    target.points[0]!.stairSteps = 7;
    target.color = '#fedcba';
    target.collapsed = true;
}

function recordTwoLanes() {
    startAutomationRecording();
    for (const [beat, gain, pan] of [
        [2, 0.8, -0.4],
        [3, 0.2, 0.6],
        [4, 0.8, -0.4],
    ] as const) {
        recordAutomationValue('recording-track', 'gain', gain, beat);
        recordAutomationValue('recording-track', 'pan', pan, beat);
    }
    stopAutomationRecording(5);
    const after = material();
    for (const [laneId, values, before] of [
        ['gain-lane', [0.8, 0.2, 0.8, 0.8], gainBefore],
        ['pan-lane', [-0.4, 0.6, -0.4, -0.4], panBefore],
    ] as const) {
        expect(after.automation.lanes.find((candidate) => candidate.id === laneId)?.points).toEqual([
            ...before.slice(0, 2),
            ...values.map((value, index) => ({ beat: index + 2, value, curve: 'linear', tension: 0 })),
            before[2],
        ]);
    }
    const entries = undoHistoryStore.value?.past.slice(1);
    expect(entries).toHaveLength(2);
    const groupId = entries?.[0]?.groupId;
    expect(groupId).toBeTruthy();
    for (const [index, laneId] of ['gain-lane', 'pan-lane'].entries()) {
        const before = initialLanes[index]?.points;
        const recorded = after.automation.lanes[index]?.points;
        expect(entries?.[index]).toMatchObject({
            kind: 'action',
            label: 'Record Automation',
            groupId,
            groupLabel: 'Record Automation',
            action: {
                type: 'restoreAutomationLanePoints',
                payload: { laneId, points: recorded, expectedPoints: before },
            },
            inverseAction: {
                type: 'restoreAutomationLanePoints',
                payload: { laneId, points: before, expectedPoints: recorded },
            },
        });
    }
    return after;
}

describe('recorded ride replay against actual peer lane changes', () => {
    let notifications: NotifyPayload[];

    beforeEach(async () => {
        Container.clear();
        notifications = [];
        const bus = createEventBus<Notifications>();
        bus.on('ui.notify', (payload) => {
            notifications.push(payload);
        });
        setNotificationEventBus(bus);
        setArrangementEventBus({ emit: () => Promise.resolve() });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('recorded peer replay');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getAutomationHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        clearActionHistory();
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const track = createTrack({ id: 'recording-track', name: 'Ride', kind: 'audio', withoutDefaultDevice: true });
        const keeper = createTrack({ id: 'keeper-track', name: 'Keeper', kind: 'audio', withoutDefaultDevice: true });
        trackStore.set({
            tracks: [{ ...track, automationMode: 'latch' }, keeper],
            selectedTrackId: track.id,
            ghostClips: [],
        });
        automationStore.set({ lanes: structuredClone(initialLanes) });
        transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120, playheadPosition: 1 });
        const context = new AudioContext({ sampleRate: 48_000 });
        Object.defineProperties(context, { baseLatency: { value: 0 }, outputLatency: { value: 0 } });
        setAutomationRecordingDependencies({ getAudioContext: () => context, getCompensationDelay: () => 0 });
        flushAutomergeStorageWrites();
        await executeAppAction({
            type: 'renameTrack',
            payload: { trackId: 'keeper-track', name: 'Prior edit', expectedName: 'Keeper' },
        });
        expect(undoHistoryStore.value?.past).toHaveLength(1);
    });

    afterEach(() => {
        stopAutomationRecording();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        transportStore.set(defaultTransportState);
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each(['gain-lane', 'pan-lane'])('refuses the whole recorded Undo unit after a peer edits %s', async (laneId) => {
        recordTwoLanes();
        const peer = mergePeer((draft) => peerEdit(draft, laneId));
        const projected = structuredClone(automationStore.value);
        const history = undoHistoryStore.value;
        const metadata = structuredClone(actionHistoryStore.value);

        const outcome = await undo({ stepOverConflicts: false });

        expect.soft(material()).toEqual(peer);
        expect.soft(automationStore.value).toEqual(projected);
        expect.soft(outcome).toEqual({ headConsumed: false });
        expect.soft(undoHistoryStore.value).toEqual(history);
        expect.soft(actionHistoryStore.value).toEqual(metadata);
        expect(notifications).toContainEqual({
            message: 'Cannot undo "Record Automation": project state has changed',
            level: 'warning',
        });
    });

    it('refuses recorded Redo without removing a peer point or curve added after Undo', async () => {
        recordTwoLanes();
        await undo({ stepOverConflicts: false });
        expect(material().automation.lanes).toEqual(initialLanes);
        const peer = mergePeer((draft) => peerEdit(draft, 'pan-lane'));
        const projected = structuredClone(automationStore.value);
        const history = undoHistoryStore.value;
        const metadata = structuredClone(actionHistoryStore.value);

        await redo({ stepOverConflicts: false });

        expect.soft(material()).toEqual(peer);
        expect.soft(automationStore.value).toEqual(projected);
        expect.soft(undoHistoryStore.value).toEqual(history);
        expect.soft(actionHistoryStore.value).toEqual(metadata);
        expect(notifications).toContainEqual({
            message: 'Cannot redo "Record Automation": project state has changed',
            level: 'warning',
        });
    });

    it('replays both unchanged recorded lanes as one user unit and preserves the prior edit', async () => {
        const tracks = structuredClone(material().tracks);
        const priorIds = undoHistoryStore.value?.past.map((entry) => entry.id);
        if (!priorIds) {
            throw new Error('Expected history before recording');
        }
        const after = recordTwoLanes();
        const recordedIds = undoHistoryStore.value?.past.slice(1).map((entry) => entry.id);
        if (!recordedIds) {
            throw new Error('Expected recorded history');
        }

        expect(await undo({ stepOverConflicts: false })).toEqual({ headConsumed: true });
        expect(material().automation.lanes).toEqual(initialLanes);
        expect(material().tracks).toEqual(tracks);
        expect(undoHistoryStore.value?.past.map((entry) => entry.id)).toEqual(priorIds);
        expect(undoHistoryStore.value?.future.map((entry) => entry.id)).toEqual(recordedIds);

        await redo({ stepOverConflicts: false });

        expect(material().automation).toEqual(after.automation);
        expect(material().tracks).toEqual(tracks);
        expect(undoHistoryStore.value?.past.map((entry) => entry.id)).toEqual([...priorIds, ...recordedIds]);
        expect(undoHistoryStore.value?.future).toEqual([]);
        expect(notifications).toEqual([]);
    });

    it('preserves same-lane peer metadata while replaying unchanged points in both directions', async () => {
        const tracks = structuredClone(material().tracks);
        const after = recordTwoLanes();
        mergePeer((draft) => {
            const gain = draft.automation.lanes[0];
            if (!gain) {
                throw new Error('Expected recorded gain lane');
            }
            gain.color = '#123abc';
            gain.collapsed = true;
        });
        const metadataLane = { ...structuredClone(initialLanes[0]), color: '#123abc', collapsed: true };

        expect(await undo({ stepOverConflicts: false })).toEqual({ headConsumed: true });

        expect(material().automation.lanes).toEqual([metadataLane, initialLanes[1], initialLanes[2]]);
        expect(material().tracks).toEqual(tracks);
        await redo({ stepOverConflicts: false });
        expect(material().automation.lanes).toEqual([
            { ...after.automation.lanes[0], color: '#123abc', collapsed: true },
            ...after.automation.lanes.slice(1),
        ]);
        expect(material().tracks).toEqual(tracks);
        expect(notifications).toEqual([]);
    });
});
