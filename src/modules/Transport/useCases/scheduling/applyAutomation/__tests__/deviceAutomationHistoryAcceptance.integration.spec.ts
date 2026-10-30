import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { persistDeviceParam, resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { clampDeviceParameterValue, createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { audioEngine, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { createAutomationLane, stopAutomationRecording } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import * as Command from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';
import { fermenterStore } from '#/modules/Fermenter/stores';
import { setFermenterDependencies } from '#/modules/Fermenter/useCases';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';

import { tempoMapStore } from '../../../../stores/tempoMapStore';
import { defaultTransportState, transportStore } from '../../../../stores/transportStore';
import { applyAutomation } from '../applyAutomation';

// Only the clock, native-carried admission and terminal Web Audio sink are
// controlled. Runtime parameter routing, Command, macro capture, Automerge,
// semantic history and session Undo/Redo all execute their production code.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getCurrentTime: () => 5,
    getCompensationDelay: () => 0,
    isDeviceCarriedByNativeSession: () => false,
}));

const TRACK_ID = 'automation-history-track';
const DEVICE_ID = 'automation-history-device';
const MANUAL_CASES = [
    { type: 'bacteria', paramId: 'mix', before: 0.25, after: 0.5 },
    { type: 'levain', paramId: 'masterGain', before: 0.2, after: 0.6 },
    { type: 'builtin-crumbs', paramId: 'masterGain', before: 0.4, after: 0.8 },
    { type: 'grinder', paramId: 'inputGain', before: 0, after: 4 },
    { type: 'grand-boule', paramId: 'masterGain', before: 0.1, after: 0.6 },
    { type: 'fermenter', paramId: 'oscEngine', before: 0, after: 2 },
] as const;

function seedDevice(type: string, paramId: string, value: number): void {
    const track = createTrack({ id: TRACK_ID, name: 'Automation history', kind: 'midi', withoutDefaultDevice: true });
    trackStore.set({
        tracks: [
            {
                ...track,
                devices: [{ id: DEVICE_ID, type, name: type, bypassed: false, parameterValues: { [paramId]: value } }],
            },
        ],
        selectedTrackId: TRACK_ID,
        ghostClips: [],
    });
    flushAutomergeStorageWrites();
}

function storedValue(paramId: string): number | undefined {
    return trackStore.value?.tracks[0]?.devices[0]?.parameterValues[paramId];
}

function rawHistoryLength(): number {
    const document = getCrdtDoc<{ actionHistory?: { entries: unknown[] } }>('root');
    return document?.actionHistory?.entries.length ?? 0;
}

function captureHistoryAndProject() {
    const revision = settlePendingProjectWritesAndCaptureRevision();
    return {
        revision,
        raw: JSON.stringify(getCrdtDoc('root')),
        projected: JSON.stringify(trackStore.value),
        semantic: JSON.stringify(actionHistoryStore.value),
        undo: JSON.stringify(undoStore.value),
        macro: JSON.stringify(macroStore.value),
        fermenter: JSON.stringify(fermenterStore.value),
    };
}

async function proveManualRecording(paramId: string, before: number, after: number): Promise<void> {
    Command.startMacroRecording();
    expect(macroStore.value?.recording).toBe(true);
    const action = {
        type: 'setDeviceParameter' as const,
        payload: { deviceId: DEVICE_ID, paramId, value: after, automationRecordingPolicy: 'suppressed' as const },
    };
    await Command.executeAppAction(action);
    await vi.waitFor(() => expect(rawHistoryLength()).toBe(1));
    expect(actionHistoryStore.value?.entries).toHaveLength(1);
    expect(undoStore.value?.past).toHaveLength(1);
    expect(macroStore.value?.currentRecording).toEqual([action]);
    expect(storedValue(paramId)).toBe(after);

    await Command.undo();
    expect(storedValue(paramId)).toBe(before);
    expect(undoStore.value?.future).toHaveLength(1);
    await Command.redo();
    expect(storedValue(paramId)).toBe(after);
    expect(undoStore.value?.past).toHaveLength(1);
    expect(undoStore.value?.future).toHaveLength(0);
    // Manual Redo deliberately records the original forward action again.
    expect(macroStore.value?.currentRecording).toEqual([action, action]);
}

describe('device automation preserves real manual history', () => {
    beforeEach(async () => {
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('device automation history acceptance');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        Command.clearUndoHistory();
        Command.resetActionReplayAuthority();
        Command.setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        actionHistoryStore.set({ entries: [] });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState, isPlaying: true });
        tempoMapStore.set({ changes: [] });
        fermenterStore.set({});
        setFermenterDependencies({
            clampDeviceParameterValue,
            persistDeviceParam,
            updateDeviceParam,
            resolveEligibleDeviceWriteTarget,
            getAllTracks: () => trackStore.value?.tracks ?? [],
        });
        vi.spyOn(audioEngine, 'updateDeviceParam').mockImplementation(() => {});
    });

    afterEach(() => {
        stopAutomationRecording();
        Command.clearUndoHistory();
        Command.resetActionReplayAuthority();
        clearHandlerRegistry();
        Command.setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        automationStore.set({ lanes: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        transportStore.set({ ...defaultTransportState });
        fermenterStore.set({});
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it.each(MANUAL_CASES)('$type records a real manual macro/history entry and supports Undo/Redo', async (input) => {
        seedDevice(input.type, input.paramId, input.before);
        await proveManualRecording(input.paramId, input.before, input.after);
    });

    it.each(['disabled', 'off'] as const)(
        'restores the saved base after a real %s transition without new history',
        async (gate) => {
            seedDevice('bacteria', 'mix', 0.25);
            await proveManualRecording('mix', 0.25, 0.5);
            const lane = createAutomationLane(TRACK_ID, `${DEVICE_ID}:mix`, 'Mix', 0, 1);
            lane.points = [
                { beat: 0, value: 0.9, curve: 'linear', tension: 0 },
                { beat: 4, value: 0.9, curve: 'linear', tension: 0 },
            ];
            automationStore.set({ lanes: [lane] });
            const dispatch = vi.spyOn(Command, 'executeAppAction');
            const beforePlayback = captureHistoryAndProject();
            vi.mocked(audioEngine.updateDeviceParam).mockClear();

            applyAutomation(1);
            expect(audioEngine.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'mix', 0.9);
            expect(dispatch).not.toHaveBeenCalled();
            expect(captureHistoryAndProject()).toEqual(beforePlayback);

            if (gate === 'disabled') {
                automationStore.set({ lanes: [{ ...lane, enabled: false }] });
            } else {
                const state = trackStore.value;
                if (!state) {
                    throw new Error('Expected the committed track store');
                }
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) => ({ ...track, automationMode: 'off' })),
                });
            }
            const beforeRestore = captureHistoryAndProject();
            vi.mocked(audioEngine.updateDeviceParam).mockClear();

            applyAutomation(2);
            await vi.waitFor(() =>
                expect(audioEngine.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'mix', 0.5)
            );
            expect(dispatch).not.toHaveBeenCalled();
            expect(captureHistoryAndProject()).toEqual(beforeRestore);
        }
    );
});
