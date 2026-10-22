import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { useStore } from '#/infra/store/useStore';
import { type Device, type Track, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, getPluginById } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import * as automationUseCases from '#/modules/Automation/useCases';
import { setAutomationRecordingDependencies, stopAutomationRecording } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeUserAppAction,
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
import { defaultTransportState, setGestureClockSource, transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { DeviceParameterControl } from '../DeviceParameterControl';

// Command, Arrangement, Automerge and history stay real. This is the engine's
// shared Web Audio/native parameter boundary; the actual RotaryKnob and Radix Slider stay real.
const engineWrites: { trackId: string; deviceId: string; paramId: string; value: number }[] = [];
let afterEngineWrite: (() => void) | null = null;
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
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
    parameterValues: { detune: 5, gain: 0.3, filterCutoff: 5000 },
};
const compressor: Device = {
    id: 'compressor-1',
    name: 'Compressor',
    type: 'builtin-compressor',
    bypassed: false,
    parameterValues: { 'comp-threshold': -20, 'comp-ratio': 4 },
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
    paramId = 'detune',
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
function knob(): HTMLElement {
    return screen.getByRole('slider', { name: 'Detune' });
}
function capturePointer(element: HTMLElement): void {
    Object.defineProperties(element, {
        setPointerCapture: { configurable: true, value: vi.fn() },
        releasePointerCapture: { configurable: true, value: vi.fn() },
        hasPointerCapture: { configurable: true, value: () => true },
    });
}
function beginKnob(element = knob()): void {
    capturePointer(element);
    fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientY: 100 });
}
function moveKnob(clientY: number, element = knob()): void {
    fireEvent.pointerMove(element, { pointerId: 1, clientY });
}
function endKnob(element = knob()): void {
    fireEvent.pointerUp(element, { pointerId: 1 });
}
async function expectCommitted(
    paramId: string,
    value: number,
    historyDepth: number,
    deviceId = synth.id
): Promise<void> {
    await waitFor(() => {
        expect(values(deviceId)[paramId]).toBe(value);
        expect(rawValues(deviceId)?.[paramId]).toBe(value);
        expect(depth()).toBe(historyDepth);
    });
}
function sliderTrack(): HTMLElement {
    const root = screen.getByRole('slider', { name: 'Threshold' }).closest('[data-slot="slider"]');
    if (!(root instanceof HTMLElement)) {
        throw new Error('Missing real Slider root');
    }
    capturePointer(root);
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        bottom: 20,
        left: 0,
        right: 100,
        width: 100,
        height: 20,
        toJSON: () => ({}),
    });
    return root;
}

describe('Inspector continuous parameter gestures through real history', () => {
    beforeEach(async () => {
        engineWrites.length = 0;
        afterEngineWrite = null;
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Inspector gestures');
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
            tracks: [testTrack([structuredClone(synth), structuredClone(compressor)])],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState, isPlaying: false });
        const context = new AudioContext();
        setAutomationRecordingDependencies({ getAudioContext: () => context, getCompensationDelay: () => 0 });
        settlePendingProjectWritesAndCaptureRevision();
    });
    afterEach(() => {
        cleanup();
        afterEngineWrite = null;
        stopAutomationRecording();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        agentProjectRepairStateStore.set(null);
        transportStore.set({ ...defaultTransportState, isPlaying: false });
        setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => null });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('previews every real Synth pointer sample without truth writes, then commits one undo entry', async () => {
        render(<Control />);
        const revision = settlePendingProjectWritesAndCaptureRevision();
        beginKnob();
        for (const y of [85, 70, 55]) {
            moveKnob(y);
            expect(values().detune).toBe(5);
            expect(rawValues()?.detune).toBe(5);
            expect(depth()).toBe(0);
            expect(settlePendingProjectWritesAndCaptureRevision()).toBe(revision);
        }
        expect(writes()).toEqual([25, 45, 65]);
        expect(knob()).toHaveAttribute('aria-valuenow', '65');
        endKnob();
        await expectCommitted('detune', 65, 1);
        expect(writes()).toEqual([25, 45, 65, 65, 65]);
        await act(() => undo());
        expect(rawValues()?.detune).toBe(5);
        expect(values().detune).toBe(5);
        expect(knob()).toHaveAttribute('aria-valuenow', '5');
        expect(writes().at(-1)).toBe(5);
        await act(() => redo());
        expect(rawValues()?.detune).toBe(65);
        expect(writes().at(-1)).toBe(65);
    });

    it('coalesces a real Compressor dB slider drag and keeps its controlled readout live', async () => {
        render(<Control deviceId={compressor.id} paramId="comp-threshold" />);
        const root = sliderTrack();
        const revision = settlePendingProjectWritesAndCaptureRevision();
        fireEvent.pointerDown(root, { button: 0, pointerId: 2, clientX: 40, clientY: 10 });
        fireEvent.pointerMove(root, { pointerId: 2, clientX: 80, clientY: 10 });
        fireEvent.pointerMove(root, { pointerId: 2, clientX: 20, clientY: 10 });
        expect(writes(compressor.id)).toEqual([-36, expect.closeTo(-12, 12), -48]);
        expect(screen.getByText('-48.0 dB')).toBeInTheDocument();
        expect(rawValues(compressor.id)?.['comp-threshold']).toBe(-20);
        expect(settlePendingProjectWritesAndCaptureRevision()).toBe(revision);
        expect(depth()).toBe(0);
        fireEvent.pointerUp(root, { pointerId: 2 });
        fireEvent.blur(screen.getByRole('slider', { name: 'Threshold' }));
        await expectCommitted('comp-threshold', -48, 1, compressor.id);
        await act(() => undo());
        expect(values(compressor.id)['comp-threshold']).toBe(-20);
        expect(rawValues(compressor.id)?.['comp-threshold']).toBe(-20);
        expect(writes(compressor.id).at(-1)).toBe(-20);
        await act(() => redo());
        expect(rawValues(compressor.id)?.['comp-threshold']).toBe(-48);
    });

    it('gives two parameter identities on two devices two independent entries', async () => {
        render(
            <>
                <Control />
                <Control deviceId={compressor.id} paramId="comp-ratio" />
            </>
        );
        beginKnob();
        moveKnob(85);
        endKnob();
        await expectCommitted('detune', 25, 1);
        fireEvent.keyDown(screen.getByRole('slider', { name: 'Ratio' }), { key: 'End' });
        const maximum = getPluginById(compressor.type)?.parameters.find((p) => p.id === 'comp-ratio')?.maxValue;
        await waitFor(() => expect(depth()).toBe(2));
        expect(values(compressor.id)['comp-ratio']).toBe(maximum);
        await act(() => undo());
        expect(values(compressor.id)['comp-ratio']).toBe(4);
        expect(rawValues()?.detune).toBe(25);
        await act(() => undo());
        expect(rawValues()?.detune).toBe(5);
    });

    it('keeps two parameters on one device in separate undo entries', async () => {
        render(
            <>
                <Control />
                <Control paramId="gain" />
            </>
        );
        beginKnob();
        moveKnob(85);
        endKnob();
        await expectCommitted('detune', 25, 1);
        fireEvent.keyDown(screen.getByRole('slider', { name: 'Gain' }), { key: 'End' });
        await expectCommitted('gain', 1, 2);
        await act(() => undo());
        expect(rawValues()?.gain).toBe(0.3);
        expect(rawValues()?.detune).toBe(25);
        await act(() => undo());
        expect(rawValues()?.detune).toBe(5);
    });

    it('keeps logarithmic previews in native units and restores the prior value', async () => {
        render(<Control paramId="filterCutoff" />);
        const parameter = getPluginById(synth.type)?.parameters.find((candidate) => candidate.id === 'filterCutoff');
        if (!parameter) {
            throw new Error('Missing Synth cutoff descriptor');
        }
        const control = screen.getByRole('slider', { name: parameter.name });
        beginKnob(control);
        moveKnob(85, control);
        const preview = engineWrites.at(-1)?.value;
        expect(preview).toBeGreaterThan(5000);
        expect(preview).toBeLessThanOrEqual(parameter.maxValue);
        expect(rawValues()?.filterCutoff).toBe(5000);
        expect(depth()).toBe(0);
        endKnob(control);
        await waitFor(() => expect(depth()).toBe(1));
        expect(rawValues()?.filterCutoff).toBe(preview);
        await act(() => undo());
        expect(rawValues()?.filterCutoff).toBe(5000);
        expect(engineWrites.at(-1)?.value).toBe(5000);
    });

    it('restores an absent field and its engine default rather than persisting a preview on undo', async () => {
        trackStore.set({ ...trackStore.value!, tracks: [testTrack([{ ...synth, parameterValues: { gain: 0.3 } }])] });
        render(<Control />);
        beginKnob();
        moveKnob(85);
        endKnob();
        await expectCommitted('detune', 20, 1);
        await act(() => undo());
        expect(Object.hasOwn(values(), 'detune')).toBe(false);
        expect(Object.hasOwn(rawValues() ?? {}, 'detune')).toBe(false);
        expect(writes().at(-1)).toBe(0);
        await act(() => redo());
        expect(rawValues()?.detune).toBe(20);
    });

    it('settles a return-to-start drag without creating history or retaining a stale preview', async () => {
        render(<Control />);
        beginKnob();
        moveKnob(85);
        moveKnob(100);
        endKnob();
        await executeUserAppAction({
            type: 'setDeviceParameter',
            payload: { deviceId: compressor.id, paramId: 'comp-ratio', value: 4 },
        });
        expect(writes()).toEqual([25, 5, 5]);
        expect(rawValues()?.detune).toBe(5);
        expect(depth()).toBe(0);
    });

    it.each(['pointerCancel', 'lostPointerCapture', 'blur', 'windowBlur'])(
        'settles %s at most once even if pointer-up follows',
        async (finish) => {
            render(<Control />);
            const control = knob();
            beginKnob(control);
            moveKnob(85, control);
            if (finish === 'pointerCancel') {
                fireEvent.pointerCancel(control, { pointerId: 1 });
            } else if (finish === 'lostPointerCapture') {
                fireEvent.lostPointerCapture(control, { pointerId: 1 });
            } else if (finish === 'blur') {
                fireEvent.blur(control);
            } else {
                fireEvent.blur(window);
            }
            endKnob(control);
            await expectCommitted('detune', 25, 1);
            expect(writes()).toEqual([25, 25, 25]);
        }
    );

    it('refuses an unmounted preview without committing a ghost edit', async () => {
        const view = render(<Control />);
        beginKnob();
        moveKnob(85);
        view.unmount();
        await executeUserAppAction({
            type: 'setDeviceParameter',
            payload: { deviceId: compressor.id, paramId: 'comp-ratio', value: 4 },
        });
        expect(rawValues()?.detune).toBe(5);
        expect(depth()).toBe(0);
        expect(writes().at(-1)).toBe(5);
    });

    it.each(['changed-value', 'changed-type', 'removed-device', 'duplicate-owner', 'frozen-change'])(
        'drops a stale gesture after %s without erasing current truth',
        async (change) => {
            render(<Control displayed={structuredClone(synth)} />);
            const control = knob();
            beginKnob(control);
            moveKnob(85, control);
            act(() => {
                const replacement = {
                    ...synth,
                    type: change === 'changed-type' ? 'crust' : synth.type,
                    parameterValues: { ...synth.parameterValues, detune: change === 'changed-value' ? 17 : 5 },
                };
                let devices: Device[];
                if (change === 'removed-device') {
                    devices = [structuredClone(compressor)];
                } else {
                    devices = [replacement, structuredClone(compressor)];
                }
                const track = {
                    ...testTrack(devices),
                    frozen: change === 'frozen-change',
                };
                trackStore.set({
                    ...trackStore.value!,
                    tracks: change === 'duplicate-owner' ? [track, { ...track, id: 'other-track' }] : [track],
                });
            });
            const before = structuredClone(trackStore.value?.tracks);
            moveKnob(70, control);
            endKnob(control);
            await waitFor(() => expect(notifyUser).toHaveBeenCalledWith(expect.any(String), 'warning'));
            expect(trackStore.value?.tracks).toEqual(before);
            expect(depth()).toBe(0);
            if (change === 'changed-value') {
                expect(writes().at(-1)).toBe(17);
            }
        }
    );

    it('preserves permission to gesture on an already-frozen owner', async () => {
        trackStore.set({ ...trackStore.value!, tracks: [{ ...testTrack([structuredClone(synth)]), frozen: true }] });
        render(<Control />);
        beginKnob();
        moveKnob(85);
        endKnob();
        await expectCommitted('detune', 25, 1);
        await act(() => undo());
        expect(rawValues()?.detune).toBe(5);
    });

    it('refuses a queued final after its captured owner frozen state changes', async () => {
        render(<Control />);
        beginKnob();
        moveKnob(85);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const snapshot = transactSnapshot(async (transaction) => {
            entered.resolve();
            await release.promise;
            const write = runWithAutomergeStorageTransaction(transaction, () => {
                trackStore.set({
                    ...trackStore.value!,
                    tracks: [{ ...testTrack([structuredClone(synth), structuredClone(compressor)]), frozen: true }],
                });
            });
            write.commit();
        });
        try {
            await entered.promise;
            endKnob();
            await act(async () => {
                release.resolve();
                await snapshot;
            });
            await waitFor(() => expect(notifyUser).toHaveBeenCalledWith(expect.any(String), 'warning'));
            expect(rawValues()?.detune).toBe(5);
            expect(depth()).toBe(0);
            expect(writes().at(-1)).toBe(5);
        } finally {
            await act(async () => {
                release.resolve();
                await snapshot;
            });
        }
    });

    it('fences a queued final commit against a same-id project transition', async () => {
        render(<Control />);
        const control = knob();
        beginKnob(control);
        moveKnob(85, control);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const snapshot = transactSnapshot(async () => {
            entered.resolve();
            await release.promise;
        });
        try {
            await entered.promise;
            endKnob(control);
            await activateProject();
            engineWrites.length = 0;
            release.resolve();
            await snapshot;
            await executeUserAppAction({
                type: 'setDeviceParameter',
                payload: { deviceId: compressor.id, paramId: 'comp-ratio', value: 4 },
            });
            expect(rawValues()?.detune).toBe(5);
            expect(depth()).toBe(0);
            expect(writes()).toEqual([]);
        } finally {
            await act(async () => {
                release.resolve();
                await snapshot;
            });
        }
    });

    it('restores authoritative runtime and UI after a refused final commit', async () => {
        render(<Control />);
        beginKnob();
        moveKnob(85);
        setRepairRequired();
        endKnob();
        await waitFor(() => expect(notifyUser).toHaveBeenCalledWith(expect.any(String), 'warning'));
        await waitFor(() => expect(knob()).toHaveAttribute('aria-valuenow', '5'));
        expect(rawValues()?.detune).toBe(5);
        expect(depth()).toBe(0);
        expect(writes().at(-1)).toBe(5);
    });

    it('reports an unexpected engine failure and does not leave a truth edit or preview', async () => {
        render(<Control />);
        beginKnob();
        moveKnob(85);
        afterEngineWrite = () => {
            if (engineWrites.length === 3) {
                throw new Error('Gesture engine rejected');
            }
        };
        endKnob();
        await waitFor(() => expect(notifyUser).toHaveBeenCalledWith('Gesture engine rejected', 'error'));
        expect(rawValues()?.detune).toBe(5);
        expect(depth()).toBe(0);
        expect(writes().at(-1)).toBe(5);
    });

    it.each(['write', 'touch', 'latch'] as const)(
        'records exact event-time samples including release before a delayed final in %s mode',
        async (automationMode) => {
            let beat = 1;
            const recording = vi.spyOn(automationUseCases, 'recordAutomationValue');
            setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => beat });
            trackStore.set({
                ...trackStore.value!,
                tracks: [{ ...testTrack([structuredClone(synth)]), automationMode }],
            });
            transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120 });
            automationStore.set({
                lanes: [
                    {
                        id: 'ride',
                        trackId: 'track-1',
                        parameterId: 'synth-1:detune',
                        parameterName: 'Detune',
                        points: [],
                        objects: [],
                        visible: true,
                        enabled: true,
                        collapsed: false,
                        minValue: -100,
                        maxValue: 100,
                    },
                ],
            });
            render(<Control />);
            beginKnob();
            for (const [index, y] of [85, 115, 55].entries()) {
                beat = index + 1;
                moveKnob(y);
            }
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            const snapshot = transactSnapshot(async () => {
                entered.resolve();
                await release.promise;
            });
            try {
                await entered.promise;
                beat = 4;
                endKnob();
                const expectedSamples = [
                    ['track-1', 'synth-1:detune', 25, 1],
                    ['track-1', 'synth-1:detune', -15, 2],
                    ['track-1', 'synth-1:detune', 65, 3],
                    ['track-1', 'synth-1:detune', 65, 4],
                ];
                // This spy calls the actual owner; its real buffered curve is flushed below.
                expect(recording.mock.calls).toEqual(expectedSamples);
                expect(rawValues()?.detune).toBe(5);
                expect(automationStore.value?.lanes[0]?.points).toEqual([]);
                expect(depth()).toBe(0);
                beat = 19;
                await act(async () => {
                    release.resolve();
                    await snapshot;
                });
                await expectCommitted('detune', 65, 1);
                expect(recording.mock.calls).toEqual(expectedSamples);
                await act(() => undo());
                expect(rawValues()?.detune).toBe(5);
                await act(() => redo());
                expect(rawValues()?.detune).toBe(65);
                expect(recording.mock.calls).toEqual(expectedSamples);
                stopAutomationRecording(4);
                const points = automationStore.value?.lanes[0]?.points ?? [];
                expect(points.map(({ beat: pointBeat, value }) => [pointBeat, value])).toEqual([
                    [1, 25],
                    [2, -15],
                    [3, 65],
                    [4, 65],
                ]);
            } finally {
                await act(async () => {
                    release.resolve();
                    await snapshot;
                });
            }
        }
    );

    it.each(['write', 'touch', 'latch'] as const)(
        'keeps slider recording at its three change events across a held final queue in %s mode',
        async (automationMode) => {
            let beat = 1;
            const recording = vi.spyOn(automationUseCases, 'recordAutomationValue');
            setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => beat });
            trackStore.set({
                ...trackStore.value!,
                tracks: [{ ...testTrack([structuredClone(compressor)]), automationMode }],
            });
            transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120 });
            automationStore.set({
                lanes: [
                    {
                        id: 'ride',
                        trackId: 'track-1',
                        parameterId: 'compressor-1:comp-threshold',
                        parameterName: 'Threshold',
                        points: [],
                        objects: [],
                        visible: true,
                        enabled: true,
                        collapsed: false,
                        minValue: -60,
                        maxValue: 0,
                    },
                ],
            });
            render(<Control deviceId={compressor.id} paramId="comp-threshold" />);
            const root = sliderTrack();
            fireEvent.pointerDown(root, { button: 0, pointerId: 2, clientX: 40, clientY: 10 });
            beat = 2;
            fireEvent.pointerMove(root, { pointerId: 2, clientX: 80, clientY: 10 });
            beat = 3;
            fireEvent.pointerMove(root, { pointerId: 2, clientX: 20, clientY: 10 });
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            const snapshot = transactSnapshot(async () => {
                entered.resolve();
                await release.promise;
            });
            try {
                await entered.promise;
                beat = 4;
                fireEvent.pointerUp(root, { pointerId: 2 });
                const expectedSamples = [
                    ['track-1', 'compressor-1:comp-threshold', -36, 1],
                    ['track-1', 'compressor-1:comp-threshold', expect.closeTo(-12, 12), 2],
                    ['track-1', 'compressor-1:comp-threshold', -48, 3],
                ];
                expect(recording.mock.calls).toEqual(expectedSamples);
                expect(rawValues(compressor.id)?.['comp-threshold']).toBe(-20);
                expect(automationStore.value?.lanes[0]?.points).toEqual([]);
                expect(depth()).toBe(0);
                beat = 19;
                await act(async () => {
                    release.resolve();
                    await snapshot;
                });
                await expectCommitted('comp-threshold', -48, 1, compressor.id);
                await act(() => undo());
                expect(rawValues(compressor.id)?.['comp-threshold']).toBe(-20);
                await act(() => redo());
                expect(rawValues(compressor.id)?.['comp-threshold']).toBe(-48);
                expect(recording.mock.calls).toEqual(expectedSamples);
                stopAutomationRecording(3);
                expect(
                    automationStore.value?.lanes[0]?.points.map(({ beat: pointBeat, value }) => [pointBeat, value])
                ).toEqual([
                    [1, -36],
                    [2, expect.closeTo(-12, 12)],
                    [3, -48],
                ]);
            } finally {
                await act(async () => {
                    release.resolve();
                    await snapshot;
                });
            }
        }
    );

    it.each(['keyboard', 'numeric', 'ctrlKey', 'metaKey', 'blur', 'windowBlur', 'pointerCancel', 'unmount'])(
        'does not add slider recording samples when %s settles or refuses its existing change',
        async (finish) => {
            const recording = vi.spyOn(automationUseCases, 'recordAutomationValue');
            setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => 1 });
            trackStore.set({
                ...trackStore.value!,
                tracks: [{ ...testTrack([structuredClone(compressor)]), automationMode: 'touch' }],
            });
            transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120 });
            const view = render(<Control deviceId={compressor.id} paramId="comp-threshold" />);
            const root = sliderTrack();
            const control = screen.getByRole('slider', { name: 'Threshold' });
            if (finish === 'keyboard') {
                fireEvent.keyDown(control, { key: 'End' });
            } else if (finish === 'numeric') {
                fireEvent.doubleClick(control);
                fireEvent.change(screen.getByRole('textbox'), { target: { value: '50' } });
                fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
            } else if (finish === 'ctrlKey' || finish === 'metaKey') {
                fireEvent.pointerDown(root, { button: 0, pointerId: 2, [finish]: true });
            } else {
                fireEvent.pointerDown(root, { button: 0, pointerId: 2, clientX: 40, clientY: 10 });
                if (finish === 'blur') {
                    fireEvent.blur(control);
                } else if (finish === 'windowBlur') {
                    fireEvent.blur(window);
                } else if (finish === 'pointerCancel') {
                    fireEvent.pointerCancel(root, { pointerId: 2 });
                } else {
                    view.unmount();
                }
            }
            // Drain real queued work using a separate same-value command, never a fixed delay.
            await executeUserAppAction({
                type: 'setDeviceParameter',
                payload: {
                    deviceId: compressor.id,
                    paramId: 'comp-ratio',
                    value: 4,
                    automationRecordingPolicy: 'suppressed',
                },
            });
            expect(recording.mock.calls).toHaveLength(1);
            expect(recording.mock.calls[0]).toEqual(['track-1', 'compressor-1:comp-threshold', expect.any(Number), 1]);
        }
    );

    it('retains event-time recording inputs when a delayed final is refused without recording its runtime restoration', async () => {
        let beat = 1;
        const recording = vi.spyOn(automationUseCases, 'recordAutomationValue');
        setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => beat });
        trackStore.set({
            ...trackStore.value!,
            tracks: [{ ...testTrack([structuredClone(synth)]), automationMode: 'touch' }],
        });
        transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120 });
        automationStore.set({
            lanes: [
                {
                    id: 'ride',
                    trackId: 'track-1',
                    parameterId: 'synth-1:detune',
                    parameterName: 'Detune',
                    points: [],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: -100,
                    maxValue: 100,
                },
            ],
        });
        render(<Control />);
        beginKnob();
        moveKnob(85);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const snapshot = transactSnapshot(async (transaction) => {
            entered.resolve();
            await release.promise;
            const write = runWithAutomergeStorageTransaction(transaction, () => {
                trackStore.set({ ...trackStore.value!, tracks: [{ ...trackStore.value!.tracks[0]!, frozen: true }] });
            });
            write.commit();
        });
        try {
            await entered.promise;
            beat = 4;
            endKnob();
            beat = 19;
            await act(async () => {
                release.resolve();
                await snapshot;
            });
            await waitFor(() => expect(notifyUser).toHaveBeenCalledWith(expect.any(String), 'warning'));
            await waitFor(() => expect(knob()).toHaveAttribute('aria-valuenow', '5'));
            expect(rawValues()?.detune).toBe(5);
            expect(depth()).toBe(0);
            expect(writes().at(-1)).toBe(5);
            expect(recording.mock.calls).toEqual([
                ['track-1', 'synth-1:detune', 25, 1],
                ['track-1', 'synth-1:detune', 25, 4],
            ]);
            stopAutomationRecording();
            expect(
                automationStore.value?.lanes[0]?.points.map(({ beat: pointBeat, value }) => [pointBeat, value])
            ).toEqual([
                [1, 25],
                [4, 25],
            ]);
        } finally {
            await act(async () => {
                release.resolve();
                await snapshot;
            });
        }
    });
});
