import { clone } from '@automerge/automerge';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { createMockAudioContext } from '#/helpers/__tests__/audioContext.mock';
import {
    configureAutomergeStoragePort,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { useStore } from '#/infra/store/useStore';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { type Device, type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getPluginById, setDeviceParameter } from '#/modules/Arrangement/useCases';
import { audioEngine, getAudioContext, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import * as automationUseCases from '#/modules/Automation/useCases';
import { setAutomationRecordingDependencies, stopAutomationRecording } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeUserAppAction,
    reconcileSessionUndoForProject,
    redo,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    stampSessionUndoWitness,
    undo,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    captureDurableDocumentWitness,
    clearActionHistory,
    compactProject,
    createCrdtDoc,
    getCrdtDoc,
    hasCrdtDoc,
    loadCrdtProject,
    markActionHistoryEntryReverted,
    persistCrdtProject,
    projectCrdtToStores,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDoc,
    resetCrdtProjectAuthority,
    sessionUndoWitnessStampPort,
    settlePendingProjectWritesAndCaptureRevision,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import { defaultTransportState, setGestureClockSource, transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { useDeviceParameterGesture } from '../../../../hooks/useDeviceParameterGesture';
import { resolveDeviceLayout } from '../../deviceLayoutRegistry';
import '../CompressorLayout';

function requireRegisteredLayout(type: string, missingMessage: string) {
    const layout = resolveDeviceLayout(type);
    if (!layout) {
        throw new Error(missingMessage);
    }
    return layout;
}
const RegisteredCompressorLayout = requireRegisteredLayout(
    'builtin-compressor',
    'Missing registered Compressor layout'
);
const RegisteredSidechainCompressorLayout = requireRegisteredLayout(
    'builtin-sidechain-compressor',
    'Missing registered Sidechain Compressor layout'
);

// Canvas, controls, dispatch, Arrangement, CRDT and history remain real.
// The real runtime writer reaches a controlled Web Audio controller, preserving ownership receipts.
const engineWrites: { trackId: string; deviceId: string; paramId: string; value: number }[] = [];
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: vi.fn(),
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    projectsToDifferentNativeBank: vi.fn(() => false),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    isDeviceCarriedByNativeSession: () => false,
    writeNativeBuiltinParameters: vi.fn(),
}));

const PROJECT_ID = 'compressor-curve-project';
const SESSION_KEY = 'sourdaw-undo-session';
const DEVICE_ID = 'compressor-1';
const deviceTypes = ['builtin-compressor', 'builtin-sidechain-compressor'] as const;
type CompressorType = (typeof deviceTypes)[number];

function prefix(type: CompressorType): string {
    return type === 'builtin-sidechain-compressor' ? 'sc-comp' : 'comp';
}
function makeDevice(type: CompressorType, absent = false): Device {
    const parameterValues: Device['parameterValues'] = {
        [`${prefix(type)}-ratio`]: 4,
    };
    if (!absent) {
        parameterValues[`${prefix(type)}-threshold`] = -20;
    }
    return {
        id: DEVICE_ID,
        name: type === 'builtin-compressor' ? 'Compressor' : 'Sidechain Compressor',
        type,
        bypassed: false,
        parameterValues,
    };
}
function installEngineDevice(device: Device, trackId: string): void {
    const strip = audioEngine.ensureTrackStrip(trackId);
    strip.deviceNodes.length = 0;
    const node = new AudioContext().createGain();
    strip.deviceNodes.push({
        deviceId: device.id,
        type: device.type,
        nodes: [node],
        inputNode: node,
        outputNode: node,
        controller: {
            setParam: (paramId, value) => engineWrites.push({ trackId, deviceId: device.id, paramId, value }),
        },
    });
}
function targetTrack(device: Device): Track {
    return {
        ...createTrack({ id: 'track-1', name: 'Guitar', kind: 'audio', withoutDefaultDevice: true }),
        devices: [device],
    };
}
function seed(type: CompressorType, absent = false): void {
    trackStore.set({
        tracks: [
            targetTrack(makeDevice(type, absent)),
            {
                ...targetTrack({ ...makeDevice('builtin-compressor'), id: 'settlement-device' }),
                id: 'settlement-track',
            },
        ],
        selectedTrackId: 'track-1',
        ghostClips: [],
    });
    for (const track of trackStore.value?.tracks ?? []) {
        for (const device of track.devices) {
            installEngineDevice(device, track.id);
        }
    }
    settlePendingProjectWritesAndCaptureRevision();
}
function values(): Record<string, number> {
    const device = trackStore.value?.tracks[0]?.devices.find((candidate) => candidate.id === DEVICE_ID);
    if (!device) {
        throw new Error('Missing real projected Compressor');
    }
    return device.parameterValues;
}
function rawTracks(): Track[] {
    const tracks = getCrdtDoc<{ tracks: { tracks: Track[] } }>('root')?.tracks.tracks;
    if (!tracks) {
        throw new Error('Missing raw CRDT track map');
    }
    return tracks;
}
function rawValues(): Record<string, number> {
    const device = rawTracks()[0]?.devices.find((candidate) => candidate.id === DEVICE_ID);
    if (!device) {
        throw new Error('Missing raw CRDT Compressor');
    }
    return device.parameterValues;
}
function depth(): number {
    return undoStore.value?.past.length ?? 0;
}
function writes(): typeof engineWrites {
    return engineWrites.filter((write) => write.deviceId === DEVICE_ID);
}
function recordedPoints(): number[][] | undefined {
    return automationStore.value?.lanes[0]?.points.map(({ beat, value }) => [beat, value]);
}
function mountThresholdGesture() {
    return renderHook(() => {
        const state = useStore(trackStore, { tracks: [], selectedTrackId: null });
        const device = state.tracks[0]?.devices.find((candidate) => candidate.id === DEVICE_ID);
        if (!device) {
            throw new Error('Required real gesture target is absent');
        }
        const param = getPluginById(device.type)?.parameters.find((candidate) => candidate.id === 'comp-threshold');
        if (!param) {
            throw new Error('Required real gesture parameter is absent');
        }
        return useDeviceParameterGesture({ device, param, trackId: 'track-1' });
    });
}
function Layout({ displayed }: { displayed?: Device }) {
    const state = useStore(trackStore, { tracks: [], selectedTrackId: null });
    const device = displayed ?? state.tracks[0]?.devices.find((candidate) => candidate.id === DEVICE_ID);
    if (!device) {
        throw new Error('Required Compressor layout was not mounted');
    }
    const descriptor = getPluginById(device.type);
    if (!descriptor) {
        throw new Error(`Missing actual registered descriptor for ${device.type}`);
    }
    if (device.type === 'builtin-compressor') {
        return <RegisteredCompressorLayout device={device} parameters={descriptor.parameters} trackId="track-1" />;
    }
    if (device.type === 'builtin-sidechain-compressor') {
        return (
            <RegisteredSidechainCompressorLayout device={device} parameters={descriptor.parameters} trackId="track-1" />
        );
    }
    throw new Error(`Unsupported actual Compressor layout type ${device.type}`);
}
function curve(): HTMLCanvasElement {
    const element = screen.getByRole('img', { name: 'Compressor transfer curve' });
    if (!(element instanceof HTMLCanvasElement)) {
        throw new Error('Required real Compressor canvas is absent');
    }
    return element;
}
function begin(): HTMLCanvasElement {
    const canvas = curve();
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 140,
        bottom: 140,
        width: 140,
        height: 140,
        toJSON: () => ({}),
    });
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 5 });
    return canvas;
}
function move(db: number, canvas = curve()): void {
    fireEvent.pointerMove(canvas, { pointerId: 5, clientY: 4 - (db / 60) * 132 });
}
function end(canvas = curve()): void {
    fireEvent.pointerUp(canvas, { pointerId: 5 });
}
async function drainActions(): Promise<void> {
    // An awaited no-op on a separate unchanged owner observes the real action
    // queue completing, including refused finals. No fixed microtask count.
    await act(() =>
        executeUserAppAction({
            type: 'setDeviceParameter',
            payload: {
                deviceId: 'settlement-device',
                paramId: 'comp-ratio',
                value: 4,
                automationRecordingPolicy: 'suppressed',
            },
        })
    );
}
function expectThresholdValue(type: CompressorType, value: number): void {
    const parameter = getPluginById(type)?.parameters.find((candidate) => candidate.id === `${prefix(type)}-threshold`);
    if (!parameter) {
        throw new Error(`Missing actual ${type} threshold descriptor`);
    }
    expect(parameter.minValue).toBe(-60);
    expect(parameter.maxValue).toBe(0);
    // The thumb exposes 0..100; both surrounding readouts carry native dB.
    const position = ((value - parameter.minValue) / (parameter.maxValue - parameter.minValue)) * 100;
    const control = screen.getByRole('slider', { name: 'Threshold' });
    expect(control).toHaveAttribute('aria-valuemin', '0');
    expect(control).toHaveAttribute('aria-valuemax', '100');
    expect(control).toHaveAttribute('aria-valuenow');
    expect(Number(control.getAttribute('aria-valuenow'))).toBeCloseTo(position, 10);
    const readouts = screen.getAllByText(`${value.toFixed(1)} dB`);
    expect(readouts).toHaveLength(2);
    for (const readout of readouts) {
        expect(readout).toBeVisible();
    }
}
async function committed(type: CompressorType, value: number, historyDepth = 1): Promise<void> {
    const id = `${prefix(type)}-threshold`;
    await waitFor(() => {
        expect(rawValues()[id]).toBe(value);
        expect(values()[id]).toBe(value);
        expect(depth()).toBe(historyDepth);
        expectThresholdValue(type, value);
    });
    expect(writes().at(-1)).toMatchObject({ trackId: 'track-1', deviceId: DEVICE_ID, paramId: id, value });
}
async function activateProject(): Promise<void> {
    const transition = runProjectLoadTransaction();
    expect(await transition.prepare()).toBe(true);
    expect(transition.activate()).toBe(true);
}
function recordMode(type: CompressorType, automationMode: 'read' | 'write' | 'touch' | 'latch'): void {
    trackStore.set({
        ...trackStore.value!,
        tracks: trackStore.value!.tracks.map((track) =>
            track.id === 'track-1' ? { ...track, automationMode } : track
        ),
    });
    transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120 });
    automationStore.set({
        lanes: [
            {
                id: 'threshold-ride',
                trackId: 'track-1',
                parameterId: `${DEVICE_ID}:${prefix(type)}-threshold`,
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
    settlePendingProjectWritesAndCaptureRevision();
}

describe('actual registered Compressor curve through real project and history', () => {
    let indexedDb: ReturnType<typeof installTransactionalIndexedDb>;
    beforeAll(() => {
        indexedDb = installTransactionalIndexedDb();
    });
    afterAll(async () => {
        await indexedDb.dispose();
    });
    beforeEach(async () => {
        vi.clearAllMocks();
        engineWrites.length = 0;
        Object.assign(audioEngine.context, createMockAudioContext());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Compressor canvas gesture');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        await compactProject();
        clearHandlerRegistry();
        clearUndoHistory();
        sessionStorage.removeItem(SESSION_KEY);
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        resetActionReplayAuthority();
        clearActionHistory();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        sessionUndoWitnessStampPort.setProvider(stampSessionUndoWitness);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        await activateProject();
        seed('builtin-compressor');
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState, isPlaying: false });
        const context = new AudioContext();
        vi.mocked(getAudioContext).mockReturnValue(context);
        setAutomationRecordingDependencies({ getAudioContext: () => context, getCompensationDelay: () => 0 });
        reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
        settlePendingProjectWritesAndCaptureRevision();
    });
    afterEach(() => {
        cleanup();
        stopAutomationRecording();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearActionHistory();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' as const }),
            clear: () => undefined,
        });
        sessionUndoWitnessStampPort.setProvider(null);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        agentProjectRepairStateStore.set(null);
        transportStore.set({ ...defaultTransportState, isPlaying: false });
        setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => null });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        sessionStorage.removeItem(SESSION_KEY);
        vi.restoreAllMocks();
    });

    it.each(deviceTypes)(
        'previews every actual %s canvas move, commits once, and restores all authorities on undo/redo',
        async (type) => {
            seed(type);
            render(<Layout />);
            const thresholdId = `${prefix(type)}-threshold`;
            const canvas = begin();
            const context = canvas.getContext('2d');
            if (!context) {
                throw new Error('Required actual canvas drawing context is absent');
            }
            const marker = vi.spyOn(context, 'arc');
            const before = structuredClone(rawValues());
            const revision = settlePendingProjectWritesAndCaptureRevision();
            for (const [index, sample] of [-15, -30, -45].entries()) {
                move(sample, canvas);
                expect(writes().map((write) => write.value)).toEqual([-15, -30, -45].slice(0, index + 1));
                expect(rawValues()).toEqual(before);
                expect(values()).toEqual(before);
                expect(depth()).toBe(0);
                expect(settlePendingProjectWritesAndCaptureRevision()).toBe(revision);
                expectThresholdValue(type, sample);
            }
            expect(marker).toHaveBeenLastCalledWith(
                37,
                expect.closeTo(type === 'builtin-sidechain-compressor' ? 103 : 104.2375, 10),
                5,
                0,
                Math.PI * 2
            );
            end(canvas);
            fireEvent.lostPointerCapture(canvas, { pointerId: 5 });
            end(canvas);
            await committed(type, -45);
            expect(writes().map((write) => write.value)).toEqual([-15, -30, -45, -45]);
            expect(writes().every((write) => write.paramId === thresholdId)).toBe(true);
            expect(Object.keys(rawValues()).sort()).toEqual(Object.keys(before).sort());
            const expectedControls = type === 'builtin-sidechain-compressor' ? 5 : 6;
            expect(screen.getAllByRole('slider')).toHaveLength(expectedControls);
            await act(() => undo());
            expect(rawValues()).toEqual(before);
            expect(values()).toEqual(before);
            expectThresholdValue(type, -20);
            expect(writes().at(-1)?.value).toBe(-20);
            await act(() => redo());
            expect(rawValues()[thresholdId]).toBe(-45);
            expect(values()[thresholdId]).toBe(-45);
            expectThresholdValue(type, -45);
            expect(writes().at(-1)?.value).toBe(-45);
        }
    );

    it.each(deviceTypes)('keeps two %s drags and a later ratio gesture separate', async (type) => {
        seed(type);
        render(<Layout />);
        begin();
        move(-30);
        move(-45);
        end();
        await committed(type, -45, 1);
        begin();
        move(-15);
        end();
        await committed(type, -15, 2);
        fireEvent.keyDown(screen.getByRole('slider', { name: 'Ratio' }), { key: 'End' });
        await waitFor(() => expect(depth()).toBe(3));
        expect(rawValues()[`${prefix(type)}-ratio`]).toBe(20);
        await act(() => undo());
        expect(rawValues()[`${prefix(type)}-ratio`]).toBe(4);
        expect(rawValues()[`${prefix(type)}-threshold`]).toBe(-15);
        await act(() => undo());
        expect(rawValues()[`${prefix(type)}-threshold`]).toBe(-45);
        await act(() => undo());
        expect(rawValues()[`${prefix(type)}-threshold`]).toBe(-20);
    });

    it.each(deviceTypes)(
        'restores absent %s threshold ownership and its actual engine default on undo',
        async (type) => {
            seed(type, true);
            render(<Layout />);
            const id = `${prefix(type)}-threshold`;
            begin();
            move(-45);
            end();
            await committed(type, -45);
            await act(() => undo());
            expect(Object.hasOwn(rawValues(), id)).toBe(false);
            expect(Object.hasOwn(values(), id)).toBe(false);
            expect(writes().at(-1)?.value).toBe(-20);
            expectThresholdValue(type, -20);
            await act(() => redo());
            expect(rawValues()[id]).toBe(-45);
        }
    );

    it.each([false, true])(
        'keeps a returned-to-start parameter unchanged when its initial field is absent=%s',
        async (absent) => {
            seed('builtin-compressor', absent);
            render(<Layout />);
            end();
            begin();
            end();
            expect(writes()).toEqual([]);
            begin();
            move(-45);
            move(-20);
            end();
            await drainActions();
            expect(Object.hasOwn(rawValues(), 'comp-threshold')).toBe(!absent);
            expect(rawValues()['comp-threshold']).toBe(absent ? undefined : -20);
            expect(depth()).toBe(0);
            expect(writes().map((write) => write.value)).toEqual([-45, -20]);
        }
    );

    it.each(['pointerCancel', 'lostPointerCapture', 'windowBlur', 'hidden', 'unmount', 'nonfinite'])(
        'restores the parameter preview and releases its real Touch ride after %s',
        async (finish) => {
            recordMode('builtin-compressor', 'touch');
            const parameterId = `${DEVICE_ID}:comp-threshold`;
            setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => 2 });
            const view = render(<Layout />);
            const canvas = begin();
            move(-45, canvas);
            expect(automationUseCases.isRecordingAutomation('track-1', parameterId)).toBe(true);
            if (finish === 'pointerCancel') {
                fireEvent.pointerCancel(canvas, { pointerId: 5 });
            } else if (finish === 'lostPointerCapture') {
                fireEvent.lostPointerCapture(canvas, { pointerId: 5 });
            } else if (finish === 'windowBlur') {
                fireEvent.blur(window);
            } else if (finish === 'hidden') {
                vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
                fireEvent(document, new Event('visibilitychange'));
            } else if (finish === 'unmount') {
                view.unmount();
            } else {
                const malformed = new Event('pointermove', { bubbles: true });
                Object.defineProperties(malformed, { pointerId: { value: 5 }, clientY: { value: Number.NaN } });
                fireEvent(canvas, malformed);
            }
            expect(automationUseCases.isRecordingAutomation('track-1', parameterId)).toBe(false);
            end(canvas);
            await drainActions();
            expect(recordedPoints()).toEqual([[2, -45]]);
            expect(rawValues()['comp-threshold']).toBe(-20);
            expect(values()['comp-threshold']).toBe(-20);
            expect(depth()).toBe(0);
            expect(writes().map((write) => write.value)).toEqual([-45, -20]);
        }
    );

    it('restores the authoritative display and engine when project admission refuses a final', async () => {
        render(<Layout />);
        begin();
        move(-45);
        act(() =>
            agentProjectRepairStateStore.set({
                audioGraphValid: false,
                detectedRevision: 'repair-revision',
                inspectionAvailable: true,
                projectInvariantsValid: false,
                rawProjectRetained: true,
                repairCandidates: [],
                status: 'repair-required',
            })
        );
        end();
        await waitFor(() => expect(notifyUser).toHaveBeenCalledWith(expect.any(String), 'warning'));
        await waitFor(() => expectThresholdValue('builtin-compressor', -20));
        expect(rawValues()['comp-threshold']).toBe(-20);
        expect(values()['comp-threshold']).toBe(-20);
        expect(depth()).toBe(0);
        expect(writes().map((write) => write.value)).toEqual([-45, -20]);
    });

    it.each([
        'value',
        'frozen',
        'chain',
        'duplicate-device-owner',
        'duplicate-track-owner',
        'device-removed',
        'same-id-type-successor',
        'project-epoch',
    ])('refuses the real queued final after %s changes without overwriting authoritative truth', async (change) => {
        render(<Layout displayed={makeDevice('builtin-compressor')} />);
        const canvas = begin();
        move(-45, canvas);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const snapshot = transactSnapshot(async (transaction) => {
            entered.resolve();
            await release.promise;
            if (change === 'project-epoch') {
                return;
            }
            const write = runWithAutomergeStorageTransaction(transaction, () => {
                const state = trackStore.value!;
                const track = state.tracks[0]!;
                const device = track.devices[0]!;
                let replacement = track;
                if (change === 'value') {
                    replacement = {
                        ...track,
                        devices: [
                            {
                                ...device,
                                parameterValues: { ...device.parameterValues, 'comp-threshold': -12 },
                            },
                        ],
                    };
                } else if (change === 'frozen') {
                    replacement = { ...track, frozen: true };
                } else if (change === 'chain') {
                    replacement = {
                        ...track,
                        devices: [device, { ...makeDevice('builtin-compressor'), id: 'extra-device' }],
                    };
                } else if (change === 'device-removed') {
                    replacement = { ...track, devices: [] };
                } else if (change === 'same-id-type-successor') {
                    replacement = {
                        ...track,
                        devices: [
                            {
                                ...makeDevice('builtin-sidechain-compressor'),
                                parameterValues: { 'sc-comp-threshold': -8 },
                            },
                        ],
                    };
                }
                const tracks = [replacement, ...state.tracks.slice(1)];
                if (change === 'duplicate-device-owner') {
                    tracks.push({ ...track, id: 'other-track' });
                }
                if (change === 'duplicate-track-owner') {
                    tracks.push({ ...track, devices: [] });
                }
                trackStore.set({ ...state, tracks });
            });
            write.commit();
        });
        try {
            await entered.promise;
            end(canvas);
            expect(depth()).toBe(0);
            if (change === 'project-epoch') {
                await activateProject();
                engineWrites.length = 0;
            }
            await act(async () => {
                release.resolve();
                await snapshot;
            });
            await drainActions();
            expect(depth()).toBe(0);
            expect(rawTracks()).toEqual(trackStore.value?.tracks);
            if (change === 'value') {
                expect(rawValues()['comp-threshold']).toBe(-12);
                expect(writes().at(-1)?.value).toBe(-12);
            } else if (change === 'same-id-type-successor') {
                expect(rawValues()).toEqual({ 'sc-comp-threshold': -8 });
                expect(writes().map((write) => write.value)).toEqual([-45]);
            } else if (change === 'project-epoch') {
                expect(rawValues()['comp-threshold']).toBe(-20);
                expect(writes()).toEqual([]);
            } else if (change === 'device-removed') {
                expect(rawTracks()[0]?.devices).toEqual([]);
                expect(writes().map((write) => write.value)).toEqual([-45]);
            } else {
                expect(rawValues()['comp-threshold']).toBe(-20);
                expect(writes().map((write) => write.value)).toEqual(change === 'frozen' ? [-45, -20] : [-45]);
            }
        } finally {
            await act(async () => {
                release.resolve();
                await snapshot;
            });
        }
    });

    it.each(deviceTypes)('fences a live %s preview from a same-ID incoming project', async (type) => {
        seed(type);
        render(<Layout />);
        const canvas = begin();
        move(-45, canvas);
        await act(() => activateProject());
        act(() => seed(type));
        engineWrites.length = 0;
        move(-15, canvas);
        end(canvas);
        await drainActions();
        expect(rawValues()[`${prefix(type)}-threshold`]).toBe(-20);
        expect(depth()).toBe(0);
        expect(writes()).toEqual([]);
    });

    it.each(['read', 'touch', 'write', 'latch'] as const)(
        'records only physical curve moves in %s mode across a real final queue',
        async (mode) => {
            const type = 'builtin-sidechain-compressor';
            // A bent ride retains its interior sample through the owner's thinning.
            const samples = [-15, -35, -45];
            seed(type);
            recordMode(type, mode);
            const recording = vi.spyOn(automationUseCases, 'recordAutomationValue');
            let beat = 1;
            setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => beat });
            render(<Layout />);
            begin();
            for (const [index, sample] of samples.entries()) {
                beat = index + 1;
                move(sample);
            }
            expect(writes().map(({ paramId, value }) => [paramId, value])).toEqual(
                samples.map((value) => ['sc-comp-threshold', value])
            );
            const expected: [string, string, number, number, unknown][] = [];
            if (mode !== 'read') {
                for (const [index, sample] of samples.entries()) {
                    expected.push(['track-1', `${DEVICE_ID}:sc-comp-threshold`, sample, index + 1, expect.any(Symbol)]);
                }
            }
            expect(recording.mock.calls).toEqual(expected);
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            const snapshot = transactSnapshot(async () => {
                entered.resolve();
                await release.promise;
            });
            try {
                await entered.promise;
                beat = 4;
                end();
                expect(automationUseCases.isRecordingAutomation('track-1', `${DEVICE_ID}:sc-comp-threshold`)).toBe(
                    mode === 'write' || mode === 'latch'
                );
                expect(recording.mock.calls).toEqual(expected);
                expect(rawValues()['sc-comp-threshold']).toBe(-20);
                expect(depth()).toBe(0);
                beat = 19;
                await act(async () => {
                    release.resolve();
                    await snapshot;
                });
                await committed(type, -45);
                await act(() => undo());
                await act(() => redo());
                expect(automationUseCases.isRecordingAutomation('track-1', `${DEVICE_ID}:sc-comp-threshold`)).toBe(
                    mode === 'write' || mode === 'latch'
                );
                expect(recording.mock.calls).toEqual(expected);
                stopAutomationRecording(3);
                const expectedPoints: [number, number][] = [];
                if (mode !== 'read') {
                    expectedPoints.push([1, -15], [2, -35], [3, -45]);
                }
                expect(automationStore.value?.lanes[0]?.points.map(({ beat: at, value }) => [at, value])).toEqual(
                    expectedPoints
                );
            } finally {
                await act(async () => {
                    release.resolve();
                    await snapshot;
                });
            }
        }
    );

    it('releases Touch recording before its real queued final and retains only the physical sample', async () => {
        recordMode('builtin-compressor', 'touch');
        const parameterId = `${DEVICE_ID}:comp-threshold`;
        let beat = 2;
        setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => beat });
        render(<Layout />);
        begin();
        move(-45);
        expect(automationUseCases.isRecordingAutomation('track-1', parameterId)).toBe(true);
        expect(automationStore.value?.lanes[0]?.points).toEqual([]);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const snapshot = transactSnapshot(async () => {
            entered.resolve();
            await release.promise;
        });
        try {
            await entered.promise;
            end();
            expect(automationUseCases.isRecordingAutomation('track-1', parameterId)).toBe(false);
            expect(depth()).toBe(0);
            beat = 19;
        } finally {
            await act(async () => {
                release.resolve();
                await snapshot;
            });
        }
        await drainActions();
        await committed('builtin-compressor', -45);
        const physicalPoints = [[2, -45]];
        expect(recordedPoints()).toEqual(physicalPoints);
        await act(() => undo());
        expect(recordedPoints()).toEqual(physicalPoints);
        await act(() => redo());
        expect(recordedPoints()).toEqual(physicalPoints);
        expect(automationUseCases.isRecordingAutomation('track-1', parameterId)).toBe(false);
    });

    it('releases a returned-to-start Touch ride without adding parameter history', async () => {
        recordMode('builtin-compressor', 'touch');
        let beat = 2;
        setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => beat });
        render(<Layout />);
        begin();
        move(-45);
        beat = 3;
        move(-20);
        end();
        expect(automationUseCases.isRecordingAutomation('track-1', `${DEVICE_ID}:comp-threshold`)).toBe(false);
        await drainActions();
        expect(recordedPoints()).toEqual([
            [2, -45],
            [3, -20],
        ]);
        expect(depth()).toBe(0);
        expect(rawValues()['comp-threshold']).toBe(-20);
    });

    it.each(['cancel', 'unmount', 'release', 'sample'] as const)(
        'keeps the real successor Touch session active after its former preview owner attempts %s',
        async (finish) => {
            recordMode('builtin-compressor', 'touch');
            let beat = 2;
            setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => beat });
            const former = mountThresholdGesture();
            const successor = mountThresholdGesture();
            act(() => {
                former.result.current.startGesture();
                former.result.current.change(-45, true);
                successor.result.current.startGesture();
                beat = 3;
                successor.result.current.change(-35, true);
            });
            act(() => {
                if (finish === 'unmount') {
                    former.unmount();
                } else if (finish === 'cancel') {
                    former.result.current.cancel();
                } else if (finish === 'release') {
                    former.result.current.settleGesture();
                } else {
                    former.result.current.change(-15, true);
                }
            });
            expect(automationUseCases.isRecordingAutomation('track-1', `${DEVICE_ID}:comp-threshold`)).toBe(true);
            expect(recordedPoints()).toEqual([]);
            act(() => successor.result.current.cancel());
            expect(automationUseCases.isRecordingAutomation('track-1', `${DEVICE_ID}:comp-threshold`)).toBe(false);
            await drainActions();
            expect(recordedPoints()).toEqual([
                [2, -45],
                [3, -35],
            ]);
            expect(depth()).toBe(0);
        }
    );

    it('does not release a successor Touch session when the former queued final completes', async () => {
        recordMode('builtin-compressor', 'touch');
        let beat = 2;
        setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => beat });
        const former = mountThresholdGesture();
        const successor = mountThresholdGesture();
        act(() => {
            former.result.current.startGesture();
            former.result.current.change(-45, true);
        });
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const snapshot = transactSnapshot(async () => {
            entered.resolve();
            await release.promise;
        });
        try {
            await entered.promise;
            act(() => former.result.current.settleGesture());
            expect(automationUseCases.isRecordingAutomation('track-1', `${DEVICE_ID}:comp-threshold`)).toBe(false);
            act(() => {
                successor.result.current.startGesture();
                beat = 3;
                successor.result.current.change(-35, true);
            });
        } finally {
            await act(async () => {
                release.resolve();
                await snapshot;
            });
        }
        await drainActions();
        expect(automationUseCases.isRecordingAutomation('track-1', `${DEVICE_ID}:comp-threshold`)).toBe(true);
        expect(recordedPoints()).toEqual([[2, -45]]);
        expect(successor.result.current.value).toBe(-35);
        act(() => successor.result.current.cancel());
        await drainActions();
        expect(recordedPoints()).toEqual([
            [2, -45],
            [3, -35],
        ]);
        expect(depth()).toBe(0);
    });

    it.each(['cancel', 'unmount', 'release', 'sample'] as const)(
        'does not release an equal-target incoming root Touch session after old-root %s',
        async (finish) => {
            recordMode('builtin-compressor', 'touch');
            let beat = 2;
            setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => beat });
            const former = mountThresholdGesture();
            act(() => {
                former.result.current.startGesture();
                former.result.current.change(-45, true);
            });
            // A real project boundary ends the outgoing recording before equal
            // target IDs are installed in the replacement document.
            act(() => {
                stopAutomationRecording(2);
                clearUndoHistory();
                const doc = getCrdtDoc<Record<string, unknown>>('root');
                if (!doc) {
                    throw new Error('Required outgoing root is absent');
                }
                replaceCrdtDoc({ id: 'root', doc: clone(doc) });
                recordMode('builtin-compressor', 'touch');
            });
            const successor = mountThresholdGesture();
            act(() => {
                successor.result.current.startGesture();
                beat = 3;
                successor.result.current.change(-35, true);
                if (finish === 'unmount') {
                    former.unmount();
                } else if (finish === 'cancel') {
                    former.result.current.cancel();
                } else if (finish === 'release') {
                    former.result.current.settleGesture();
                } else {
                    former.result.current.change(-15, true);
                }
            });
            expect(automationUseCases.isRecordingAutomation('track-1', `${DEVICE_ID}:comp-threshold`)).toBe(true);
            expect(recordedPoints()).toEqual([]);
            act(() => successor.result.current.cancel());
            await drainActions();
            expect(recordedPoints()).toEqual([[3, -35]]);
            expect(depth()).toBe(0);
        }
    );

    it('does not record rollback as a delayed touch sample', async () => {
        recordMode('builtin-compressor', 'touch');
        const recording = vi.spyOn(automationUseCases, 'recordAutomationValue');
        setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => 2 });
        render(<Layout />);
        const canvas = begin();
        move(-45, canvas);
        fireEvent.pointerCancel(canvas, { pointerId: 5 });
        end(canvas);
        await drainActions();
        expect(recording.mock.calls).toEqual([['track-1', `${DEVICE_ID}:comp-threshold`, -45, 2, expect.any(Symbol)]]);
        expect(writes().map((write) => write.value)).toEqual([-45, -20]);
        expect(depth()).toBe(0);
    });

    it.each(
        deviceTypes.flatMap((type) => [
            { type, absent: false },
            { type, absent: true },
        ])
    )(
        'reconstructs persisted $type truth and fresh validated history with initial field absent=$absent',
        async ({ type, absent }) => {
            seed(type, absent);
            const before = structuredClone(rawValues());
            const view = render(<Layout />);
            const id = `${prefix(type)}-threshold`;
            begin();
            move(-45);
            end();
            await committed(type, -45);
            const liveEntry = undoStore.value?.past[0];
            expect(liveEntry).toBeDefined();
            await waitFor(() => expect(sessionStorage.getItem(SESSION_KEY)).toContain(id));
            await persistCrdtProject();
            const witness = captureDurableDocumentWitness();
            const serialized = sessionStorage.getItem(SESSION_KEY);
            expect(serialized).not.toBeNull();
            const persisted: unknown = JSON.parse(serialized ?? 'null');
            expect(persisted).toMatchObject({ witness });
            view.unmount();
            removeCrdtDoc('root');
            expect(hasCrdtDoc('root')).toBe(false);
            createCrdtDoc('root');
            await expect(loadCrdtProject()).resolves.toBe(true);
            act(() => projectCrdtToStores({ resetProjections: true }));
            expect(captureDurableDocumentWitness()).toBe(witness);
            expect(rawValues()[id]).toBe(-45);
            expect(values()[id]).toBe(-45);
            clearHandlerRegistry();
            registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
            reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
            expect(depth()).toBe(1);
            expect(undoStore.value?.past[0]).not.toBe(liveEntry);
            render(<Layout />);
            await act(() => undo());
            expect(rawValues()).toEqual(before);
            expect(values()).toEqual(before);
            expect(writes().at(-1)).toMatchObject({ paramId: id, value: -20 });
            expectThresholdValue(type, -20);
            await act(() => redo());
            expect(rawValues()[id]).toBe(-45);
            expect(values()[id]).toBe(-45);
            expect(writes().at(-1)).toMatchObject({ paramId: id, value: -45 });
            expectThresholdValue(type, -45);
        }
    );
    it.each(
        deviceTypes.flatMap((type) =>
            (['touch', 'latch', 'write'] as const).flatMap((sourceMode) =>
                (['read', 'off', 'touch', 'latch', 'write'] as const).flatMap((endMode) =>
                    [false, true].flatMap((moveAfterSwitch) =>
                        (['release', 'pointerCancel', 'unmount'] as const).map((ending) => ({
                            type,
                            sourceMode,
                            endMode,
                            moveAfterSwitch,
                            ending,
                        }))
                    )
                )
            )
        )
    )(
        'settles $type curve $sourceMode -> $endMode, moved=$moveAfterSwitch, ending=$ending',
        async ({ type, sourceMode, endMode, moveAfterSwitch, ending }) => {
            seed(type);
            recordMode(type, 'read');
            const recording = vi.spyOn(automationUseCases, 'recordAutomationValue');
            const parameterId = `${DEVICE_ID}:${prefix(type)}-threshold`;
            await act(() =>
                executeUserAppAction({
                    type: 'setAutomationMode',
                    payload: { trackId: 'track-1', mode: sourceMode },
                })
            );
            expect(trackStore.value?.tracks[0]?.automationMode).toBe(sourceMode);
            const view = render(<Layout />);
            const canvas = begin();
            move(-45, canvas);
            expect(automationUseCases.isRecordingAutomation('track-1', parameterId)).toBe(true);
            const sourceSamples = recording.mock.calls.length;
            await act(() =>
                executeUserAppAction({
                    type: 'setAutomationMode',
                    payload: { trackId: 'track-1', mode: endMode },
                })
            );
            expect(trackStore.value?.tracks[0]?.automationMode).toBe(endMode);
            expect(recording).toHaveBeenCalledTimes(sourceSamples);
            if (moveAfterSwitch) {
                move(-30, canvas);
            }
            const finalValue = moveAfterSwitch ? -30 : -45;
            const endRecords = endMode === 'touch' || endMode === 'latch' || endMode === 'write';
            const samples = sourceSamples + (moveAfterSwitch && endRecords ? 1 : 0);
            expect(recording).toHaveBeenCalledTimes(samples);
            expect(writes().at(-1)?.value).toBe(finalValue);
            expect(rawValues()[`${prefix(type)}-threshold`]).toBe(-20);
            const modeHistory = depth();
            if (ending === 'release') {
                end(canvas);
                await committed(type, finalValue, modeHistory + 1);
                await act(() => undo());
                expect(rawValues()[`${prefix(type)}-threshold`]).toBe(-20);
                await act(() => redo());
                expect(rawValues()[`${prefix(type)}-threshold`]).toBe(finalValue);
            } else {
                if (ending === 'unmount') {
                    view.unmount();
                } else {
                    fireEvent.pointerCancel(canvas, { pointerId: 5 });
                }
                await drainActions();
                expect(rawValues()[`${prefix(type)}-threshold`]).toBe(-20);
                expect(writes().at(-1)?.value).toBe(-20);
                expect(depth()).toBe(modeHistory);
            }
            expect(automationUseCases.isRecordingAutomation('track-1', parameterId)).toBe(
                endMode === 'latch' || endMode === 'write'
            );
            expect(recording).toHaveBeenCalledTimes(samples);
            if (endMode === 'read' || endMode === 'off') {
                await act(() =>
                    executeUserAppAction({
                        type: 'setAutomationMode',
                        payload: { trackId: 'track-1', mode: 'touch' },
                    })
                );
                expect(trackStore.value?.tracks[0]?.automationMode).toBe('touch');
                expect(automationUseCases.isRecordingAutomation('track-1', parameterId)).toBe(false);
            }
            act(() => stopAutomationRecording());
            expect(automationUseCases.isRecordingAutomation('track-1', parameterId)).toBe(false);
            expect(recording).toHaveBeenCalledTimes(samples);
        }
    );

    it.each(['cancel', 'unmount', 'release'] as const)(
        'preserves a newer effective runtime write after former curve %s',
        async (ending) => {
            const view = render(<Layout />);
            const canvas = begin();
            move(-45, canvas);
            updateDeviceParam('track-1', DEVICE_ID, 'comp-threshold', -10);
            const before = [...writes()];
            if (ending === 'unmount') {
                view.unmount();
            } else if (ending === 'cancel') {
                fireEvent.pointerCancel(canvas, { pointerId: 5 });
            } else {
                end(canvas);
            }
            await drainActions();
            expect(writes()).toEqual(before);
            expect(rawValues()['comp-threshold']).toBe(-20);
            expect(depth()).toBe(0);
        }
    );

    it.each(deviceTypes)('admits fresh %s curve movement after an intervening runtime write', async (type) => {
        seed(type);
        const paramId = `${prefix(type)}-threshold`;
        render(<Layout />);
        const canvas = begin();
        move(-45, canvas);
        updateDeviceParam('track-1', DEVICE_ID, paramId, -10);
        move(-30, canvas);
        expect(writes().map((write) => write.value)).toEqual([-45, -10, -30]);
        expectThresholdValue(type, -30);
        expect(rawValues()[paramId]).toBe(-20);
        expect(depth()).toBe(0);
        end(canvas);
        await committed(type, -30);
        expect(writes().map((write) => write.value)).toEqual([-45, -10, -30, -30]);
        await act(() => undo());
        expect(rawValues()[paramId]).toBe(-20);
        expect(writes().at(-1)?.value).toBe(-20);
        await act(() => redo());
        expect(rawValues()[paramId]).toBe(-30);
        expect(writes().at(-1)?.value).toBe(-30);
    });

    it('preserves a newer same-key MIDI Touch producer on curve cancellation', () => {
        recordMode('builtin-compressor', 'touch');
        const view = render(<Layout />);
        const canvas = begin();
        move(-45, canvas);
        act(() => {
            setDeviceParameter(DEVICE_ID, 'comp-threshold', -10, { transient: true });
        });
        const before = [...writes()];
        view.unmount();
        expect(writes()).toEqual(before);
        expect(automationUseCases.isRecordingAutomation('track-1', `${DEVICE_ID}:comp-threshold`)).toBe(true);
        expect(rawValues()['comp-threshold']).toBe(-20);
    });
});
