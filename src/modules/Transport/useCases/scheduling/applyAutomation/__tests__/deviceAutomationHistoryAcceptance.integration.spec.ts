import { change, clone } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { persistDeviceParam, resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import {
    clampDeviceParameterValue,
    createTrack,
    getArrangementHandlers,
    getAutomationDeviceDescriptor,
    setAutomationMode,
} from '#/modules/Arrangement/useCases';
import * as AudioEngine from '#/modules/AudioEngine/useCases';
import { audioEngine, isDeviceCarriedByNativeSession } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    createAutomationLane,
    isRecordingAutomation,
    recordAutomationValue,
    releaseTouchAutomation,
    setAutomationRecordingDependencies,
    startAutomationRecording,
    stopAutomationRecording,
} from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import * as Command from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    captureProjectRootIdentity,
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    replaceCrdtDoc,
    replaceCrdtDocInLineage,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';
import { fermenterStore } from '#/modules/Fermenter/stores';
import { setFermenterDependencies } from '#/modules/Fermenter/useCases';
import { externalPluginParameterStore } from '#/modules/PluginHost/stores';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';

import { tempoMapStore } from '../../../../stores/tempoMapStore';
import { defaultTransportState, transportStore } from '../../../../stores/transportStore';
import { disposePlayheadScheduler } from '../../../playheadScheduler/disposePlayheadScheduler';
import { schedulerSession } from '../../../playheadScheduler/schedulerSession';
import { stopPlayheadScheduler } from '../../../playheadScheduler/stopPlayheadScheduler';
import { executePlayheadSeek } from '../../../transportControls/executePlayheadSeek';
import { pausePlayback } from '../../../transportControls/pausePlayback';
import { stopPlayback } from '../../../transportControls/stopPlayback';
import { applyAutomation } from '../applyAutomation';

// Engine clocks, carrier admission and terminal engine I/O are controlled.
// Runtime parameter routing, scheduler teardown, Command, macro capture,
// Automerge, semantic history and session Undo/Redo execute production code.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getCurrentTime: vi.fn(() => 5),
    getCompensationDelay: () => 0,
    isDeviceCarriedByNativeSession: vi.fn(() => false),
    getAudioContext: () => ({ currentTime: 5, sampleRate: 48000 }),
    stopAllScheduled: vi.fn(),
    cancelTrackAutomationRamps: vi.fn(),
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
                devices: [
                    {
                        id: DEVICE_ID,
                        type,
                        name: type,
                        bypassed: false,
                        parameterValues: {
                            ...Object.fromEntries(
                                (getAutomationDeviceDescriptor(type)?.parameters ?? []).map((parameter) => [
                                    parameter.id,
                                    parameter.defaultValue,
                                ])
                            ),
                            [paramId]: value,
                        },
                    },
                ],
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

type Track = NonNullable<typeof trackStore.value>['tracks'][number];
type Root = { tracks: { tracks: Track[] }; automation: NonNullable<typeof automationStore.value> };

function requireRoot() {
    const root = getCrdtDoc<Root>('root');
    if (!root) {
        throw new Error('Expected the installed project root');
    }
    return root;
}

function editTrack(edit: (track: Track) => Track): void {
    const state = trackStore.value;
    if (!state) {
        throw new Error('Expected the projected tracks');
    }
    trackStore.set({ ...state, tracks: state.tracks.map(edit) });
}

function constantLane(value = 0.9, parameterId = `${DEVICE_ID}:mix`, min = 0, max = 1) {
    const lane = createAutomationLane(TRACK_ID, parameterId, parameterId, min, max);
    lane.points = [
        { beat: 0, value, curve: 'linear', tension: 0 },
        { beat: 4, value, curve: 'linear', tension: 0 },
    ];
    return lane;
}

function assertRuntimeOnly(run: () => void, assertRuntime: () => void): void {
    const dispatch = vi.spyOn(Command, 'executeAppAction');
    dispatch.mockClear();
    const before = captureHistoryAndProject();
    vi.mocked(audioEngine.updateDeviceParam).mockClear();
    run();
    assertRuntime();
    expect(dispatch).not.toHaveBeenCalled();
    expect(captureHistoryAndProject()).toEqual(before);
}

function expectedRuntimeKey(type: string, paramId: string): string {
    if (type !== 'fermenter') {
        return paramId;
    }
    const aliases: Record<string, string> = {
        filterCutoff: 'cutoff',
        filterResonance: 'resonance',
        filterEnvAmount: 'mod_env_to_filter',
        lfoPitchAmount: 'mod_lfo_to_pitch',
        oscDrift: 'drift',
        oscEngine: 'engine',
        portamentoTime: 'portamento',
    };
    return aliases[paramId] ?? paramId.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function expectMix(value: number): void {
    expect(audioEngine.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'mix', value);
}

async function seedManualMix() {
    seedDevice('bacteria', 'mix', 0.25);
    await proveManualRecording('mix', 0.25, 0.5);
    const lane = constantLane();
    automationStore.set({ lanes: [lane] });
    assertRuntimeOnly(
        () => applyAutomation(1),
        () => expectMix(0.9)
    );
    return lane;
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
        externalPluginParameterStore.set({ byInstanceId: {} });
        setFermenterDependencies({
            clampDeviceParameterValue,
            persistDeviceParam,
            updateDeviceParam: (...args) => AudioEngine.updateDeviceParam(...args),
            resolveEligibleDeviceWriteTarget,
            getAllTracks: () => trackStore.value?.tracks ?? [],
        });
        vi.spyOn(audioEngine, 'updateDeviceParam').mockImplementation(() => {});
        vi.spyOn(audioEngine, 'setTransportInfo').mockImplementation(() => {});
        vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(false);
        vi.mocked(AudioEngine.getCurrentTime).mockReturnValue(5);
        setAutomationRecordingDependencies({
            getAudioContext: AudioEngine.getAudioContext,
            getCompensationDelay: AudioEngine.getCompensationDelay,
        });
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
        transportStore.set(defaultTransportState);
        fermenterStore.set({});
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
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
                setAutomationMode(TRACK_ID, 'off');
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

    it.each(MANUAL_CASES)(
        '$type delivers both endpoints of every currently declared automatable parameter without history',
        async (input) => {
            seedDevice(input.type, input.paramId, input.before);
            await proveManualRecording(input.paramId, input.before, input.after);
            const descriptor = getAutomationDeviceDescriptor(input.type);
            expect(descriptor?.id).toBe(input.type);
            const parameters = descriptor?.parameters.filter((parameter) => parameter.automatable) ?? [];
            expect(parameters.length).toBeGreaterThan(0);
            const delivered: string[] = [];
            for (const parameter of parameters) {
                expect(parameter.maxValue, `${input.type}:${parameter.id} has a playable span`).toBeGreaterThan(
                    parameter.minValue
                );
                const key = expectedRuntimeKey(input.type, parameter.id);
                // Separate real scope entries deliver both legal endpoints exactly;
                // the continuous-slew law is independently retained in the unit specs.
                for (const value of [parameter.minValue, parameter.maxValue]) {
                    automationStore.set({ lanes: [] });
                    applyAutomation(0);
                    const lane = constantLane(
                        value,
                        `${DEVICE_ID}:${parameter.id}`,
                        parameter.minValue,
                        parameter.maxValue
                    );
                    automationStore.set({ lanes: [lane] });
                    assertRuntimeOnly(
                        () => applyAutomation(1),
                        () => {
                            expect(
                                audioEngine.updateDeviceParam,
                                `${input.type}:${parameter.id}=${value}`
                            ).toHaveBeenCalledExactlyOnceWith(TRACK_ID, DEVICE_ID, key, value);
                        }
                    );
                }
                delivered.push(parameter.id);
            }
            expect(delivered).toEqual(parameters.map((parameter) => parameter.id));
            console.info(`AC-005 parameter coverage ${input.type}: ${delivered.join(',')}`);
        }
    );

    it.each(MANUAL_CASES)(
        '$type preserves history through its carrier contract, immutable bypass/release and base restoration',
        async (input) => {
            seedDevice(input.type, input.paramId, input.before);
            await proveManualRecording(input.paramId, input.before, input.after);
            const parameter = getAutomationDeviceDescriptor(input.type)?.parameters.find(
                (candidate) => candidate.id === input.paramId
            );
            if (!parameter) {
                throw new Error('Missing admitted representative');
            }
            const value = parameter.maxValue;
            const key = expectedRuntimeKey(input.type, input.paramId);
            const lane = constantLane(value, `${DEVICE_ID}:${input.paramId}`, parameter.minValue, parameter.maxValue);
            automationStore.set({ lanes: [lane] });
            const carried = input.type !== 'builtin-crumbs';
            vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(carried);
            const full = vi.spyOn(AudioEngine, 'updateDeviceParam');
            const fallback = vi.spyOn(AudioEngine, 'holdWebFallbackDeviceParam');
            if (!carried) {
                // Crumbs has no native built-in body: its real fallback door refuses.
                assertRuntimeOnly(
                    () => AudioEngine.holdWebFallbackDeviceParam(TRACK_ID, DEVICE_ID, key, value),
                    () => {
                        expect(audioEngine.updateDeviceParam).not.toHaveBeenCalled();
                    }
                );
                fallback.mockClear();
            }
            assertRuntimeOnly(
                () => applyAutomation(1),
                () => {
                    expect(carried ? fallback : full).toHaveBeenCalledExactlyOnceWith(TRACK_ID, DEVICE_ID, key, value);
                    expect(carried ? full : fallback).not.toHaveBeenCalled();
                    expect(audioEngine.updateDeviceParam).toHaveBeenCalledExactlyOnceWith(
                        TRACK_ID,
                        DEVICE_ID,
                        key,
                        value
                    );
                }
            );
            editTrack((track) => ({
                ...track,
                devices: track.devices.map((device) => ({ ...device, bypassed: true })),
            }));
            full.mockClear();
            fallback.mockClear();
            assertRuntimeOnly(
                () => applyAutomation(2),
                () => {
                    expect(carried ? fallback : full).toHaveBeenCalledExactlyOnceWith(TRACK_ID, DEVICE_ID, key, value);
                    expect(carried ? full : fallback).not.toHaveBeenCalled();
                }
            );
            editTrack((track) => ({
                ...track,
                devices: track.devices.map((device) => ({ ...device, bypassed: false })),
            }));
            full.mockClear();
            fallback.mockClear();
            assertRuntimeOnly(
                () => applyAutomation(3),
                () => {
                    expect(full).toHaveBeenCalledExactlyOnceWith(TRACK_ID, DEVICE_ID, key, value);
                    expect(fallback).not.toHaveBeenCalled();
                    expect(audioEngine.updateDeviceParam).toHaveBeenCalledExactlyOnceWith(
                        TRACK_ID,
                        DEVICE_ID,
                        key,
                        value
                    );
                }
            );
            automationStore.set({ lanes: [{ ...lane, enabled: false }] });
            full.mockClear();
            fallback.mockClear();
            assertRuntimeOnly(
                () => applyAutomation(4),
                () => {
                    expect(audioEngine.updateDeviceParam).toHaveBeenCalledExactlyOnceWith(
                        TRACK_ID,
                        DEVICE_ID,
                        key,
                        input.after
                    );
                }
            );
        }
    );

    it.each(['canonical', 'legacy-type', 'bare'] as const)(
        'resolves the real %s target without history',
        async (form) => {
            await seedManualMix();
            let target = 'mix';
            if (form === 'canonical') {
                target = `${DEVICE_ID}:mix`;
            } else if (form === 'legacy-type') {
                target = 'bacteria:mix';
            }
            automationStore.set({ lanes: [constantLane(0.8, target)] });
            assertRuntimeOnly(
                () => applyAutomation(2),
                () => expectMix(0.8)
            );
        }
    );

    it.each([
        'missing-owner',
        'duplicate-owner',
        'duplicate-type',
        'unknown',
        'non-automatable',
        'missing-key',
    ] as const)('refuses %s without runtime, history or macro effects', async (refusal) => {
        await seedManualMix();
        let target = `${DEVICE_ID}:mix`;
        if (refusal === 'missing-owner') {
            target = 'absent:mix';
        }
        if (refusal === 'duplicate-owner') {
            const track = trackStore.value?.tracks[0];
            if (!track) {
                throw new Error('Expected the owner');
            }
            trackStore.set({ tracks: [track, { ...track, id: 'second-owner' }], selectedTrackId: TRACK_ID });
        }
        if (refusal === 'duplicate-type') {
            editTrack((track) => ({
                ...track,
                devices: [...track.devices, { ...track.devices[0]!, id: 'second-device' }],
            }));
            target = 'bacteria:mix';
        }
        if (refusal === 'unknown') {
            persistDeviceParam(DEVICE_ID, 'unknown', 0.2);
            target = `${DEVICE_ID}:unknown`;
        }
        if (refusal === 'non-automatable') {
            seedDevice('levain', 'autoDivisi', 0);
            expect(
                getAutomationDeviceDescriptor('levain')?.parameters.find((parameter) => parameter.id === 'autoDivisi')
                    ?.automatable
            ).toBe(false);
            target = `${DEVICE_ID}:autoDivisi`;
        }
        if (refusal === 'missing-key') {
            editTrack((track) => ({
                ...track,
                devices: track.devices.map((device) => ({ ...device, parameterValues: {} })),
            }));
        }
        // Reconcile the intentional old lane removal before the refusal baseline.
        automationStore.set({ lanes: [] });
        applyAutomation(2);
        automationStore.set({ lanes: [constantLane(0.8, target)] });
        assertRuntimeOnly(
            () => applyAutomation(3),
            () => expect(audioEngine.updateDeviceParam).not.toHaveBeenCalled()
        );
    });

    it.each(['yeast', 'knead', 'midi-fx'] as const)('refuses the persisted %s device target', async (type) => {
        await seedManualMix();
        if (type === 'midi-fx') {
            editTrack((track) => ({
                ...track,
                midiFx: [
                    {
                        id: 'fx',
                        type: 'velocity',
                        name: 'Velocity',
                        bypassed: false,
                        parameterValues: { velocity: 0.2 },
                    },
                ],
            }));
        } else {
            expect(getAutomationDeviceDescriptor(type)?.parameters).toEqual([]);
            seedDevice(type, 'bogus', 0.2);
        }
        automationStore.set({ lanes: [] });
        applyAutomation(2);
        automationStore.set({ lanes: [constantLane(0.8, type === 'midi-fx' ? 'velocity' : `${DEVICE_ID}:bogus`)] });
        const midi = vi.spyOn(AudioEngine, 'updateMidiFxParam');
        assertRuntimeOnly(
            () => applyAutomation(3),
            () => {
                expect(audioEngine.updateDeviceParam).not.toHaveBeenCalled();
                expect(midi).not.toHaveBeenCalled();
            }
        );
    });

    it.each(['read', 'touch', 'latch', 'write'] as const)(
        'plays in %s mode when no recording session is active',
        async (mode) => {
            await seedManualMix();
            setAutomationMode(TRACK_ID, mode);
            expect(isRecordingAutomation(TRACK_ID, `${DEVICE_ID}:mix`)).toBe(false);
            assertRuntimeOnly(
                () => applyAutomation(2),
                () => expectMix(0.9)
            );
        }
    );

    it.each(['touch', 'latch', 'write'] as const)(
        'suppresses playback during a real active %s recording',
        async (mode) => {
            await seedManualMix();
            setAutomationMode(TRACK_ID, mode);
            startAutomationRecording();
            if (mode !== 'write') {
                recordAutomationValue(TRACK_ID, `${DEVICE_ID}:mix`, 0.3, 1);
            }
            expect(isRecordingAutomation(TRACK_ID, `${DEVICE_ID}:mix`)).toBe(true);
            assertRuntimeOnly(
                () => applyAutomation(2),
                () => expect(audioEngine.updateDeviceParam).not.toHaveBeenCalled()
            );
        }
    );

    it.each(['touch', 'latch'] as const)(
        'returns through real %s AutoMatch without adding manual history',
        async (mode) => {
            await seedManualMix();
            setAutomationMode(TRACK_ID, mode);
            startAutomationRecording();
            recordAutomationValue(TRACK_ID, `${DEVICE_ID}:mix`, 0.3, 1);
            releaseTouchAutomation(TRACK_ID, `${DEVICE_ID}:mix`);
            expect(isRecordingAutomation(TRACK_ID, `${DEVICE_ID}:mix`)).toBe(false);
            // Recording/release legitimately writes the lane before this baseline.
            assertRuntimeOnly(
                () => applyAutomation(4),
                () => expectMix(0.3)
            );
            vi.mocked(AudioEngine.getCurrentTime).mockReturnValue(5.075);
            assertRuntimeOnly(
                () => applyAutomation(4),
                () => {
                    expect(audioEngine.updateDeviceParam).toHaveBeenCalledOnce();
                    expect(vi.mocked(audioEngine.updateDeviceParam).mock.lastCall?.[3]).toBeCloseTo(0.42, 10);
                }
            );
            vi.mocked(AudioEngine.getCurrentTime).mockReturnValue(5.2);
            assertRuntimeOnly(
                () => applyAutomation(4),
                () => {
                    expect(audioEngine.updateDeviceParam).toHaveBeenCalledOnce();
                    expect(vi.mocked(audioEngine.updateDeviceParam).mock.lastCall?.[3]).toBeCloseTo(0.612, 10);
                }
            );
        }
    );

    it('uses clip-local ownership, linked material and material-duplicate suppression without history', async () => {
        await seedManualMix();
        editTrack((track) => ({
            ...track,
            clips: [
                {
                    id: 'clip',
                    trackId: TRACK_ID,
                    name: 'Clip',
                    startBeat: 0,
                    endBeat: 4,
                    type: 'midi',
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                    gain: 1,
                    color: '',
                    locked: false,
                    muted: false,
                },
            ],
        }));
        automationStore.set({ lanes: [] });
        applyAutomation(0);
        const trackLane = constantLane(0.2);
        const clipLane = { ...constantLane(0.8), clipId: 'clip' };
        automationStore.set({ lanes: [trackLane, clipLane] });
        assertRuntimeOnly(
            () => applyAutomation(2),
            () => {
                expect(audioEngine.updateDeviceParam).toHaveBeenCalledExactlyOnceWith(TRACK_ID, DEVICE_ID, 'mix', 0.8);
            }
        );
        automationStore.set({ lanes: [] });
        applyAutomation(0);
        const source = { ...constantLane(0.8, `${DEVICE_ID}:macro1`), id: 'source' };
        const linked = { ...constantLane(0.1), points: [], linkedLaneId: source.id, linkScale: 0.5 };
        automationStore.set({ lanes: [source, linked] });
        assertRuntimeOnly(
            () => applyAutomation(3),
            () => expectMix(0.4)
        );
        automationStore.set({ lanes: [] });
        applyAutomation(0);
        const held = { ...constantLane(0.1), points: [{ beat: 0, value: 0.1, curve: 'linear' as const, tension: 0 }] };
        const material = constantLane(0.7);
        automationStore.set({ lanes: [held, material] });
        assertRuntimeOnly(
            () => applyAutomation(2),
            () => {
                expect(audioEngine.updateDeviceParam).toHaveBeenCalledExactlyOnceWith(TRACK_ID, DEVICE_ID, 'mix', 0.7);
            }
        );
    });

    it.each(['off', 'disabled', 'removed'] as const)(
        'restores the latest typed manual base after %s through an immutable snapshot',
        async (gate) => {
            const lane = await seedManualMix();
            await Command.executeAppAction({
                type: 'setDeviceParameter',
                payload: { deviceId: DEVICE_ID, paramId: 'mix', value: 0.65, automationRecordingPolicy: 'suppressed' },
            });
            expect(storedValue('mix')).toBe(0.65);
            expect(undoStore.value?.past).toHaveLength(2);
            expect(macroStore.value?.currentRecording).toHaveLength(3);
            if (gate === 'off') {
                setAutomationMode(TRACK_ID, 'off');
            }
            if (gate === 'disabled') {
                automationStore.set({ lanes: [{ ...lane, enabled: false }] });
            }
            if (gate === 'removed') {
                automationStore.set({ lanes: [] });
            }
            assertRuntimeOnly(
                () => applyAutomation(2),
                () => expectMix(0.65)
            );
        }
    );

    it.each(['child-only', 'same-lineage-peer', 'same-lineage-rollback', 'refused-replacement'] as const)(
        'retains restoration authority across %s',
        async (operation) => {
            await seedManualMix();
            const identity = captureProjectRootIdentity();
            const root = requireRoot();
            if (operation === 'child-only') {
                createCrdtDoc('branch_preview');
                removeCrdtDoc('branch_preview');
            }
            if (operation === 'same-lineage-peer') {
                const peer = change(clone(root), (document) => {
                    document.tracks.tracks[0]!.devices[0]!.parameterValues.mix = 0.7;
                });
                replaceCrdtDocInLineage({ id: 'root', doc: peer });
                projectCrdtToStores();
                expect(storedValue('mix')).toBe(0.7);
            }
            if (operation === 'same-lineage-rollback') {
                const peer = change(clone(root), (document) => {
                    document.tracks.tracks[0]!.name = 'Peer rename';
                });
                replaceCrdtDocInLineage({ id: 'root', doc: peer });
                projectCrdtToStores();
                replaceCrdtDocInLineage({ id: 'root', doc: clone(root) });
                projectCrdtToStores();
            }
            if (operation === 'refused-replacement') {
                // Superseding preparation refuses the old request before any root installs.
                const transition = runProjectLoadTransaction();
                expect(await transition.prepare()).toBe(true);
                const successor = runProjectLoadTransaction();
                expect(await successor.prepare()).toBe(true);
                expect(transition.activate()).toBe(false);
                expect(successor.activate()).toBe(true);
            }
            expect(captureProjectRootIdentity()).toBe(identity);
            setAutomationMode(TRACK_ID, 'off');
            assertRuntimeOnly(
                () => applyAutomation(2),
                () => expectMix(operation === 'same-lineage-peer' ? 0.7 : 0.5)
            );
        }
    );

    it.each(['same-bytes', 'same-ids-off', 'same-ids-empty', 'null-intermediate'] as const)(
        'fences outgoing driving receipts after a real %s root installation',
        async (replacement) => {
            await seedManualMix();
            const identity = captureProjectRootIdentity();
            let incoming = clone(requireRoot());
            if (replacement !== 'same-bytes') {
                incoming = change(incoming, (document) => {
                    document.tracks.tracks[0]!.devices[0]!.parameterValues.mix = 0.2;
                    document.tracks.tracks[0]!.automationMode = 'off';
                    if (replacement === 'same-ids-empty') {
                        document.automation.lanes = [];
                    }
                });
            }
            replaceCrdtDoc({ id: 'root', doc: incoming });
            projectCrdtToStores({ resetProjections: true });
            expect(captureProjectRootIdentity()).not.toBe(identity);
            if (replacement === 'null-intermediate') {
                automationStore.set(null);
            }
            assertRuntimeOnly(
                () => applyAutomation(2),
                () => {
                    if (replacement === 'same-bytes') {
                        expectMix(0.9);
                    } else {
                        expect(audioEngine.updateDeviceParam).not.toHaveBeenCalled();
                    }
                }
            );
            if (replacement === 'same-bytes') {
                setAutomationMode(TRACK_ID, 'off');
                assertRuntimeOnly(
                    () => applyAutomation(3),
                    () => expectMix(0.5)
                );
            } else if (replacement === 'null-intermediate') {
                automationStore.set({ lanes: [] });
                assertRuntimeOnly(
                    () => applyAutomation(3),
                    () => expect(audioEngine.updateDeviceParam).not.toHaveBeenCalled()
                );
            }
        }
    );

    it.each(['stop-scheduler', 'dispose', 'stop', 'pause', 'seek'] as const)(
        'fences same-root same-ID receipts after real %s teardown',
        async (teardown) => {
            await seedManualMix();
            const rootIdentity = captureProjectRootIdentity();
            const generation = schedulerSession.generation;
            if (teardown === 'seek') {
                const posts: unknown[] = [];
                vi.stubGlobal(
                    'Worker',
                    class {
                        onmessage: ((event: MessageEvent) => void) | null = null;
                        postMessage(message: unknown) {
                            posts.push(message);
                        }
                        terminate() {}
                    }
                );
                await executePlayheadSeek(3);
                expect(posts).toContainEqual({
                    type: 'start',
                    interval: defaultTransportState.scheduleGrainMs,
                    generation: schedulerSession.generation,
                });
                expect(transportStore.value?.playheadPosition).toBe(3);
                stopPlayheadScheduler();
            }
            if (teardown === 'stop-scheduler') {
                stopPlayheadScheduler();
            }
            if (teardown === 'dispose') {
                disposePlayheadScheduler();
            }
            if (teardown === 'stop') {
                await stopPlayback();
            }
            if (teardown === 'pause') {
                pausePlayback();
                await vi.waitFor(() => expect(schedulerSession.generation).toBeGreaterThan(generation));
            }
            expect(schedulerSession.generation).toBeGreaterThan(generation);
            expect(captureProjectRootIdentity()).toBe(rootIdentity);
            automationStore.set({ lanes: [] });
            assertRuntimeOnly(
                () => applyAutomation(2),
                () => expect(audioEngine.updateDeviceParam).not.toHaveBeenCalled()
            );
        }
    );

    it.each(['root', 'scheduler', 'absent-device'] as const)(
        'does not carry bypass release across %s ownership loss',
        async (boundary) => {
            const lane = await seedManualMix();
            vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(true);
            editTrack((track) => ({
                ...track,
                devices: track.devices.map((device) => ({ ...device, bypassed: true })),
            }));
            applyAutomation(1);
            if (boundary === 'root') {
                const incoming = change(clone(requireRoot()), (document) => {
                    document.tracks.tracks[0]!.devices[0]!.bypassed = false;
                });
                replaceCrdtDoc({ id: 'root', doc: incoming });
                projectCrdtToStores({ resetProjections: true });
            } else if (boundary === 'scheduler') {
                stopPlayheadScheduler();
                editTrack((track) => ({
                    ...track,
                    devices: track.devices.map((device) => ({ ...device, bypassed: false })),
                }));
            } else {
                const oldTrack = trackStore.value?.tracks[0];
                if (!oldTrack) {
                    throw new Error('Expected the track');
                }
                editTrack((track) => ({ ...track, devices: [] }));
                automationStore.set({ lanes: [] });
                applyAutomation(2);
                editTrack((track) => ({
                    ...track,
                    devices: oldTrack.devices.map((device) => ({ ...device, bypassed: false })),
                }));
                automationStore.set({ lanes: [lane] });
            }
            const full = vi.spyOn(AudioEngine, 'updateDeviceParam');
            const fallback = vi.spyOn(AudioEngine, 'holdWebFallbackDeviceParam');
            full.mockClear();
            fallback.mockClear();
            assertRuntimeOnly(
                () => applyAutomation(3),
                () => {
                    expect(full).not.toHaveBeenCalled();
                    expect(fallback).toHaveBeenCalledExactlyOnceWith(TRACK_ID, DEVICE_ID, 'mix', 0.9);
                    expectMix(0.9);
                }
            );
        }
    );

    it.each(['bacteria', 'yeast', 'knead'] as const)(
        'refuses the prior driving base after a same-ID %s owner loses parameter admission',
        async (type) => {
            const lane = await seedManualMix();
            seedDevice(type, 'bogus', 0.2);
            editTrack((track) => ({
                ...track,
                devices: track.devices.map((device) => ({ ...device, parameterValues: { bogus: 0.2 } })),
            }));
            automationStore.set({ lanes: [{ ...lane, parameterId: `${DEVICE_ID}:bogus`, enabled: false }] });
            assertRuntimeOnly(
                () => applyAutomation(2),
                () => expect(audioEngine.updateDeviceParam).not.toHaveBeenCalled()
            );
        }
    );

    it('retains unknown-family delivery and current-base restoration compatibility', async () => {
        await seedManualMix();
        automationStore.set({ lanes: [] });
        applyAutomation(0);
        seedDevice('unregistered-family', 'custom', 0.35);
        const lane = constantLane(0.8, `${DEVICE_ID}:custom`);
        automationStore.set({ lanes: [lane] });
        assertRuntimeOnly(
            () => applyAutomation(1),
            () =>
                expect(audioEngine.updateDeviceParam).toHaveBeenCalledExactlyOnceWith(
                    TRACK_ID,
                    DEVICE_ID,
                    'custom',
                    0.8
                )
        );
        setAutomationMode(TRACK_ID, 'off');
        assertRuntimeOnly(
            () => applyAutomation(2),
            () =>
                expect(audioEngine.updateDeviceParam).toHaveBeenCalledExactlyOnceWith(
                    TRACK_ID,
                    DEVICE_ID,
                    'custom',
                    0.35
                )
        );
    });

    it('retains declared hosted-plugin delivery while refusing a fabricated manual base', async () => {
        await seedManualMix();
        automationStore.set({ lanes: [] });
        applyAutomation(0);
        seedDevice('external-plugin', '7', 0.35);
        editTrack((track) => ({
            ...track,
            devices: track.devices.map((device) => ({ ...device, externalInstanceId: 'instance' })),
        }));
        externalPluginParameterStore.set({
            byInstanceId: {
                instance: {
                    engineAttached: true,
                    parameters: [
                        {
                            id: 7,
                            name: 'Drive',
                            value: 0.35,
                            defaultValue: 0,
                            minValue: 0,
                            maxValue: 1,
                            unit: '',
                            isAutomatable: true,
                        },
                    ],
                },
            },
        });
        automationStore.set({ lanes: [constantLane(0.8, `${DEVICE_ID}:7`)] });
        assertRuntimeOnly(
            () => applyAutomation(1),
            () => expect(audioEngine.updateDeviceParam).toHaveBeenCalledExactlyOnceWith(TRACK_ID, DEVICE_ID, '7', 0.8)
        );
        setAutomationMode(TRACK_ID, 'off');
        assertRuntimeOnly(
            () => applyAutomation(2),
            () => expect(audioEngine.updateDeviceParam).not.toHaveBeenCalled()
        );
    });

    it.each(['track', 'clip'] as const)(
        'drives an empty %s follower from real scaled source material without history',
        async (scope) => {
            await seedManualMix();
            automationStore.set({ lanes: [] });
            applyAutomation(0);
            editTrack((track) => ({
                ...track,
                clips: [
                    {
                        id: 'linked-clip',
                        trackId: TRACK_ID,
                        name: 'Linked clip',
                        startBeat: 0,
                        endBeat: 4,
                        type: 'midi',
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '',
                        locked: false,
                        muted: false,
                    },
                ],
            }));
            const source = constantLane(0.8, `${DEVICE_ID}:macro1`);
            const follower = { ...constantLane(), points: [], linkedLaneId: source.id, linkScale: 0.5 };
            const trackLane = constantLane(0.2);
            automationStore.set({
                lanes:
                    scope === 'clip' ? [source, trackLane, { ...follower, clipId: 'linked-clip' }] : [source, follower],
            });
            assertRuntimeOnly(
                () => applyAutomation(2),
                () => {
                    expect(vi.mocked(audioEngine.updateDeviceParam).mock.calls).toEqual([
                        [TRACK_ID, DEVICE_ID, 'macro1', 0.8],
                        [TRACK_ID, DEVICE_ID, 'mix', 0.4],
                    ]);
                }
            );
            if (scope === 'clip') {
                assertRuntimeOnly(
                    () => applyAutomation(5),
                    () => expectMix(0.2)
                );
            }
        }
    );

    it.each(['missing-source', 'cycle', 'nonlinked-empty'] as const)(
        'refuses %s through the real evaluator without history',
        async (shape) => {
            await seedManualMix();
            automationStore.set({ lanes: [] });
            applyAutomation(0);
            const empty = { ...constantLane(), points: [] };
            if (shape === 'nonlinked-empty') {
                automationStore.set({ lanes: [empty] });
            }
            if (shape === 'missing-source') {
                automationStore.set({ lanes: [{ ...empty, linkedLaneId: 'missing' }] });
            }
            if (shape === 'cycle') {
                const other = { ...constantLane(0.8, `${DEVICE_ID}:macro1`), points: [], linkedLaneId: empty.id };
                automationStore.set({ lanes: [{ ...empty, linkedLaneId: other.id }, other] });
            }
            assertRuntimeOnly(
                () => applyAutomation(2),
                () => expect(audioEngine.updateDeviceParam).not.toHaveBeenCalled()
            );
        }
    );

    it.each(['off', 'disabled', 'recording'] as const)(
        'retains empty-follower %s gating and base semantics without playback history',
        async (gate) => {
            await seedManualMix();
            automationStore.set({ lanes: [] });
            applyAutomation(0);
            const source = constantLane(0.8, `${DEVICE_ID}:macro1`);
            const follower = { ...constantLane(), points: [], linkedLaneId: source.id, linkScale: 0.5 };
            automationStore.set({ lanes: [source, follower] });
            assertRuntimeOnly(
                () => applyAutomation(1),
                () => expectMix(0.4)
            );
            if (gate === 'off') {
                setAutomationMode(TRACK_ID, 'off');
            }
            if (gate === 'disabled') {
                automationStore.set({ lanes: [source, { ...follower, enabled: false }] });
            }
            if (gate === 'recording') {
                setAutomationMode(TRACK_ID, 'touch');
                startAutomationRecording();
                recordAutomationValue(TRACK_ID, follower.parameterId, 0.3, 1);
                expect(isRecordingAutomation(TRACK_ID, follower.parameterId)).toBe(true);
            }
            assertRuntimeOnly(
                () => applyAutomation(2),
                () => {
                    const mix = vi.mocked(audioEngine.updateDeviceParam).mock.calls.filter((call) => call[2] === 'mix');
                    expect(mix).toEqual(gate === 'recording' ? [] : [[TRACK_ID, DEVICE_ID, 'mix', 0.5]]);
                }
            );
        }
    );

    it('gives an empty follower the material of its real source when suppressing a held duplicate', async () => {
        await seedManualMix();
        automationStore.set({ lanes: [] });
        applyAutomation(0);
        const source = constantLane(0.8, `${DEVICE_ID}:macro1`);
        const follower = { ...constantLane(), points: [], linkedLaneId: source.id, linkScale: 0.5 };
        const held = { ...constantLane(0.1), points: [{ beat: 0, value: 0.1, curve: 'linear' as const, tension: 0 }] };
        automationStore.set({ lanes: [source, follower, held] });
        assertRuntimeOnly(
            () => applyAutomation(2),
            () => {
                expect(vi.mocked(audioEngine.updateDeviceParam).mock.calls).toEqual([
                    [TRACK_ID, DEVICE_ID, 'macro1', 0.8],
                    [TRACK_ID, DEVICE_ID, 'mix', 0.4],
                ]);
            }
        );
    });
});
