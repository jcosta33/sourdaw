import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { useStore } from '#/infra/store/useStore';
import { type Device, type Track, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, getPluginById } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    settlePendingProjectWritesAndCaptureRevision,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { DeviceParameterControl } from '../DeviceParameterControl';

// Command, Arrangement, Automerge and history stay real. This is the engine's
// shared Web Audio/native parameter boundary; no live graph exists in Vitest.
const engineWrites: { trackId: string; deviceId: string; paramId: string; value: number }[] = [];
let afterEngineWrite: (() => void) | null = null;
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/ControlSurface/presentations/views', () => ({
    MidiLearnButton: () => null,
    MidiLearnRotaryKnob: () => null,
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cancelPendingAudioBufferImport: vi.fn(),
    reconcileAutoInputMonitoring: vi.fn(),
    stopTrackInputMonitoring: vi.fn(),
    rearmCommittedTrackInputMonitoring: vi.fn(),

    startFaustNote: vi.fn(),
    soundsNativeNotes: vi.fn(() => false),
    writeNativeBuiltinParameters: vi.fn(),
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    projectsToDifferentNativeBank: vi.fn(() => false),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    discardDecodedAudioFile: vi.fn(),
    updateDeviceParam: (trackId: string, deviceId: string, paramId: string, value: number) => {
        engineWrites.push({ trackId, deviceId, paramId, value });
        afterEngineWrite?.();
    },
    updateDevicePatch: vi.fn(),
    addMidiFxToStrip: vi.fn(),
    analyzePitchForClip: vi.fn(),
    applyNoteExpression: vi.fn(),
    applyRuntimeGraphDelta: vi.fn(),
    audioEngine: {},
    cacheAudioBuffer: vi.fn(),
    clearReportedLatency: vi.fn(),
    createRuntimeGraphTopologyFingerprint: vi.fn(),
    decodeAudioFile: vi.fn(),
    ensureBusStrip: vi.fn(),
    garbageCollectCachedAudioBuffersByAge: vi.fn(),
    garbageCollectCachedAudioBuffersBySize: vi.fn(),
    garbageCollectFreezeAudioBuffers: vi.fn(),
    getAudioContext: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    getCompensationDelay: vi.fn(),
    getDefaultBendRangeSemitones: vi.fn(),
    getDeviceChainTailSeconds: vi.fn(),
    getEngineState: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    getRuntimeGraphRevision: vi.fn(),
    getTrackStrip: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(),
    matchesRuntimeDeviceChainTopology: vi.fn(),
    removeBusStrip: vi.fn(),
    removeMidiFxFromStrip: vi.fn(),
    removeSend: vi.fn(),
    removeTrackStrip: vi.fn(),
    deactivateTrackStrip: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
    reportLatency: vi.fn(),
    resolveToasterPadBinding: vi.fn(),
    setBusGain: vi.fn(),
    setSend: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackOutput: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackSoloGate: vi.fn(),
    startInputMonitoring: vi.fn(),
    stopInputMonitoring: vi.fn(),
    unwireSidechainRoute: vi.fn(),
    updateDeviceBypass: vi.fn(),
    updateMidiFxBypass: vi.fn(),
    updateMidiFxParam: vi.fn(),
    wireSidechainRoute: vi.fn(),
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiControl: () => Promise.resolve(true),
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));

function testTrack(devices: Device[]): Track {
    return {
        id: 'track-1',
        name: 'Guitar',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#00ff88',
        clips: [],
        devices,
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
}

const synth: Device = {
    id: 'synth-1',
    name: 'Synth',
    type: 'builtin-synth',
    bypassed: false,
    parameterValues: { waveform: 2 },
};
const crust: Device = {
    id: 'crust-1',
    name: 'Crust',
    type: 'crust',
    bypassed: false,
    parameterValues: { oversampling: 4 },
};
function values(deviceId = synth.id): Record<string, number> {
    const device = trackStore.value?.tracks[0]?.devices.find((candidate) => candidate.id === deviceId);
    if (!device) {
        throw new Error(`Missing fixture device ${deviceId}`);
    }
    return device.parameterValues;
}
function rawValues(deviceId = synth.id): Record<string, number> | undefined {
    return getCrdtDoc<{ tracks: { tracks: Track[] } }>('root')?.tracks.tracks[0]?.devices.find(
        (device) => device.id === deviceId
    )?.parameterValues;
}
function depth(): number {
    return undoStore.value?.past.length ?? 0;
}
function writes(deviceId = synth.id): number[] {
    return engineWrites.filter((write) => write.deviceId === deviceId).map((write) => write.value);
}
function Control({
    deviceId = synth.id,
    paramId = 'waveform',
    displayed,
}: {
    deviceId?: string;
    paramId?: string;
    displayed?: Device;
}) {
    const state = useStore(trackStore, { tracks: [], selectedTrackId: null });
    const device = displayed ?? state.tracks[0]?.devices.find((candidate) => candidate.id === deviceId);
    if (!device) {
        return null;
    }
    const param = getPluginById(device.type)?.parameters.find((candidate) => candidate.id === paramId);
    if (!param) {
        throw new Error(`Missing declared parameter ${paramId}`);
    }
    return <DeviceParameterControl device={device} param={param} trackId="track-1" />;
}
async function activateProject(): Promise<void> {
    const transition = runProjectLoadTransaction();
    expect(await transition.prepare()).toBe(true);
    expect(transition.activate()).toBe(true);
}
function setRepairRequired(): void {
    agentProjectRepairStateStore.set({
        audioGraphValid: false,
        detectedRevision: 'repair-revision',
        inspectionAvailable: true,
        projectInvariantsValid: false,
        rawProjectRetained: true,
        repairCandidates: [],
        status: 'repair-required',
    });
}
async function choose(name: string, value: number, historyDepth: number): Promise<void> {
    fireEvent.change(screen.getByRole('combobox', { name }), { target: { value: String(value) } });
    await waitFor(() => expect(depth()).toBe(historyDepth));
}

describe('Inspector discrete parameter history', () => {
    beforeEach(async () => {
        engineWrites.length = 0;
        afterEngineWrite = null;
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Inspector selections');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' as const }),
            clear: () => undefined,
        });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        await activateProject();
        trackStore.set({
            tracks: [testTrack([structuredClone(synth), structuredClone(crust)])],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        settlePendingProjectWritesAndCaptureRevision();
    });
    afterEach(() => {
        cleanup();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        agentProjectRepairStateStore.set(null);
        afterEngineWrite = null;
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('commits the rendered waveform once and restores project, engine and select with real undo/redo', async () => {
        render(<Control />);
        await choose('Waveform', 3, 1);
        expect(values().waveform).toBe(3);
        expect(rawValues()?.waveform).toBe(3);
        expect(writes()).toEqual([3]);
        expect(screen.getByRole('combobox', { name: 'Waveform' })).toHaveValue('3');
        await act(() => undo());
        expect(values().waveform).toBe(2);
        expect(rawValues()?.waveform).toBe(2);
        expect(writes()).toEqual([3, 2]);
        expect(screen.getByRole('combobox', { name: 'Waveform' })).toHaveValue('2');
        await act(() => redo());
        expect(values().waveform).toBe(3);
        expect(rawValues()?.waveform).toBe(3);
        expect(writes()).toEqual([3, 2, 3]);
    });
    it('commits literal Crust factors independently from another device identity', async () => {
        render(
            <>
                <Control />
                <Control deviceId={crust.id} paramId="oversampling" />
            </>
        );
        await choose('Waveform', 3, 1);
        await choose('Oversampling', 2, 2);
        expect(values(crust.id).oversampling).toBe(2);
        expect(rawValues(crust.id)?.oversampling).toBe(2);
        expect(writes(crust.id)).toEqual([2]);
        await act(() => undo());
        expect(values(crust.id).oversampling).toBe(4);
        expect(values().waveform).toBe(3);
        expect(writes(crust.id)).toEqual([2, 4]);
        await act(() => undo());
        expect(values().waveform).toBe(2);
        await act(() => redo());
        await act(() => redo());
        expect(values(crust.id).oversampling).toBe(2);
        expect(writes(crust.id)).toEqual([2, 4, 2]);
    });
    it('restores absent field ownership and the descriptor default on undo', async () => {
        trackStore.set({ ...trackStore.value!, tracks: [testTrack([{ ...synth, parameterValues: {} }])] });
        render(<Control />);
        await choose('Waveform', 3, 1);
        await act(() => undo());
        expect(values()).toEqual({});
        expect(rawValues()).toEqual({});
        const defaultValue = getPluginById('builtin-synth')?.parameters.find(
            (param) => param.id === 'waveform'
        )?.defaultValue;
        expect(writes()).toEqual([3, defaultValue]);
        await act(() => redo());
        expect(rawValues()?.waveform).toBe(3);
    });
    it('leaves a same-value selection without engine work or history', async () => {
        render(<Control />);
        const revision = settlePendingProjectWritesAndCaptureRevision();
        fireEvent.change(screen.getByRole('combobox', { name: 'Waveform' }), { target: { value: '2' } });
        expect(settlePendingProjectWritesAndCaptureRevision()).toBe(revision);
        expect(writes()).toEqual([]);
        expect(depth()).toBe(0);
        await choose('Waveform', 3, 1);
        await act(() => undo());
        expect(values().waveform).toBe(2);
        expect(depth()).toBe(0);
    });
    it.each(['changed-value', 'removed-device', 'removed-track', 'changed-type', 'absent-value'])(
        'refuses a stale displayed target: %s',
        async (change) => {
            render(<Control displayed={structuredClone(synth)} />);
            act(() => {
                let devices: Device[] = [
                    {
                        ...synth,
                        type: change === 'changed-type' ? 'crust' : synth.type,
                        parameterValues:
                            change === 'absent-value' ? {} : { waveform: change === 'changed-value' ? 1 : 2 },
                    },
                    structuredClone(crust),
                ];
                if (change === 'removed-device') {
                    devices = [structuredClone(crust)];
                }
                trackStore.set({
                    ...trackStore.value!,
                    tracks: change === 'removed-track' ? [] : [{ ...testTrack(devices), frozen: false }],
                });
            });
            let revision = '';
            act(() => {
                revision = settlePendingProjectWritesAndCaptureRevision();
            });
            fireEvent.change(screen.getByRole('combobox', { name: 'Waveform' }), { target: { value: '3' } });
            await waitFor(() => expect(notifyUser).toHaveBeenCalledWith(expect.any(String), 'warning'));
            expect(settlePendingProjectWritesAndCaptureRevision()).toBe(revision);
            if (change === 'removed-track') {
                expect(trackStore.value?.tracks).toEqual([]);
            } else {
                expect(values(crust.id).oversampling).toBe(4);
            }
            expect(writes()).toEqual([]);
            expect(depth()).toBe(0);
        }
    );
    it.each(['before', 'after-engine'])(
        'refuses repair-required %s and preserves project/history with engine rollback',
        async (when) => {
            render(<Control />);
            if (when === 'before') {
                setRepairRequired();
            } else {
                afterEngineWrite = () => {
                    if (engineWrites.length === 1) {
                        setRepairRequired();
                    }
                };
            }
            fireEvent.change(screen.getByRole('combobox', { name: 'Waveform' }), { target: { value: '3' } });
            await waitFor(() =>
                expect(notifyUser).toHaveBeenCalledWith(expect.any(String), when === 'before' ? 'warning' : 'error')
            );
            expect(values().waveform).toBe(2);
            expect(rawValues()?.waveform).toBe(2);
            expect(writes()).toEqual(when === 'before' ? [] : [3, 2]);
            expect(depth()).toBe(0);
        }
    );
    it('reports unexpected dispatch rejection without leaving a project edit or history', async () => {
        render(<Control />);
        afterEngineWrite = () => {
            if (engineWrites.length === 1) {
                throw new Error('Engine parameter rejected');
            }
        };
        fireEvent.change(screen.getByRole('combobox', { name: 'Waveform' }), { target: { value: '3' } });
        await waitFor(() => expect(notifyUser).toHaveBeenCalledWith('Engine parameter rejected', 'error'));
        expect(values().waveform).toBe(2);
        expect(rawValues()?.waveform).toBe(2);
        expect(writes()).toEqual([3, 2]);
        expect(depth()).toBe(0);
    });
    it('preserves the existing permission to edit an already-frozen device', async () => {
        trackStore.set({ ...trackStore.value!, tracks: [{ ...testTrack([structuredClone(synth)]), frozen: true }] });
        render(<Control />);
        await choose('Waveform', 3, 1);
        expect(values().waveform).toBe(3);
        await act(() => undo());
        expect(rawValues()?.waveform).toBe(2);
        expect(writes()).toEqual([3, 2]);
    });
    it('refuses a queued selection after the observed owner frozen state changes', async () => {
        render(<Control />);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const snapshot = transactSnapshot(async (transaction) => {
            entered.resolve();
            await release.promise;
            const write = runWithAutomergeStorageTransaction(transaction, () => {
                trackStore.set({
                    ...trackStore.value!,
                    tracks: [{ ...testTrack([structuredClone(synth), structuredClone(crust)]), frozen: true }],
                });
            });
            write.commit();
        });
        await entered.promise;
        fireEvent.change(screen.getByRole('combobox', { name: 'Waveform' }), { target: { value: '3' } });
        await act(async () => {
            release.resolve();
            await snapshot;
        });
        await waitFor(() => expect(notifyUser).toHaveBeenCalledWith(expect.any(String), 'warning'));
        expect(values().waveform).toBe(2);
        expect(rawValues()?.waveform).toBe(2);
        expect(trackStore.value?.tracks[0]?.frozen).toBe(true);
        expect(writes()).toEqual([]);
        expect(depth()).toBe(0);
    });
    it('drops a queued selection when a project transition reuses all target identities', async () => {
        render(<Control />);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const snapshot = transactSnapshot(async () => {
            entered.resolve();
            await release.promise;
        });
        await entered.promise;
        fireEvent.change(screen.getByRole('combobox', { name: 'Waveform' }), { target: { value: '3' } });
        await activateProject();
        release.resolve();
        await snapshot;
        // A later real command is an observable queue barrier, and the positive
        // control proves the fresh project still admits this exact selector.
        await choose('Waveform', 1, 1);
        expect(values().waveform).toBe(1);
        expect(writes()).toEqual([1]);
        await act(() => undo());
        expect(rawValues()?.waveform).toBe(2);
    });
});
