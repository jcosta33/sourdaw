import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { useStore } from '#/infra/store/useStore';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { type Device, type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getPluginById } from '#/modules/Arrangement/useCases';
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
    resetCrdtProjectAuthority,
    sessionUndoWitnessStampPort,
    settlePendingProjectWritesAndCaptureRevision,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import { defaultTransportState, setGestureClockSource, transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { resolveDeviceLayout } from '../../deviceLayoutRegistry';
import '../DistortionLayout';

const RegisteredDistortionLayout = resolveDeviceLayout('builtin-distortion');
if (!RegisteredDistortionLayout) {
    throw new Error('Missing registered Distortion layout');
}

const engineWrites: { trackId: string; deviceId: string; paramId: string; value: number }[] = [];
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: (trackId: string, deviceId: string, paramId: string, value: number) => {
        engineWrites.push({ trackId, deviceId, paramId, value });
    },
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    projectsToDifferentNativeBank: vi.fn(() => false),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    isDeviceCarriedByNativeSession: () => false,
    writeNativeBuiltinParameters: vi.fn(),
}));

const PROJECT_ID = 'distortion-curve-project';
const SESSION_KEY = 'sourdaw-undo-session';
const DEVICE_ID = 'distortion-1';
const PARAM_ID = 'dist-drive';

function makeDevice(absent = false): Device {
    return {
        id: DEVICE_ID,
        name: 'Distortion',
        type: 'builtin-distortion',
        bypassed: false,
        parameterValues: absent ? {} : { [PARAM_ID]: 20 },
    };
}

function targetTrack(device: Device): Track {
    return {
        ...createTrack({ id: 'track-1', name: 'Guitar', kind: 'audio', withoutDefaultDevice: true }),
        devices: [device],
    };
}

function seed(absent = false): void {
    trackStore.set({
        tracks: [
            targetTrack(makeDevice(absent)),
            {
                ...targetTrack({ ...makeDevice(), id: 'settlement-device' }),
                id: 'settlement-track',
            },
        ],
        selectedTrackId: 'track-1',
        ghostClips: [],
    });
    settlePendingProjectWritesAndCaptureRevision();
}

function values(): Record<string, number> {
    const device = trackStore.value?.tracks[0]?.devices.find((candidate) => candidate.id === DEVICE_ID);
    if (!device) {
        throw new Error('Missing real projected Distortion');
    }
    return device.parameterValues;
}

function rawValues(): Record<string, number> {
    const device = getCrdtDoc<{ tracks: { tracks: Track[] } }>('root')?.tracks.tracks[0]?.devices.find(
        (candidate) => candidate.id === DEVICE_ID
    );
    if (!device) {
        throw new Error('Missing raw CRDT Distortion');
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

function depth(): number {
    return undoStore.value?.past.length ?? 0;
}

function Layout({ displayed, driveAvailable = true }: { displayed?: Device; driveAvailable?: boolean }) {
    const state = useStore(trackStore, { tracks: [], selectedTrackId: null });
    const device = displayed ?? state.tracks[0]?.devices.find((candidate) => candidate.id === DEVICE_ID);
    if (!device) {
        throw new Error('Required Distortion layout was not mounted');
    }
    const descriptor = getPluginById(device.type);
    if (!descriptor) {
        throw new Error('Missing real Distortion descriptor');
    }
    let parameters = descriptor.parameters;
    if (!driveAvailable) {
        parameters = parameters.filter((parameter) => parameter.id !== PARAM_ID);
    }
    return <RegisteredDistortionLayout device={device} parameters={parameters} trackId="track-1" />;
}

function curve(): HTMLCanvasElement {
    const element = screen.getByRole('img', { name: 'Distortion transfer curve' });
    if (!(element instanceof HTMLCanvasElement)) {
        throw new Error('Required real Distortion canvas is absent');
    }
    return element;
}

function begin(): HTMLCanvasElement {
    const canvas = curve();
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 5, clientY: 100 });
    return canvas;
}

function move(clientY: number, canvas = curve()): void {
    fireEvent.pointerMove(canvas, { pointerId: 5, clientY });
}

function end(canvas = curve()): void {
    fireEvent.pointerUp(canvas, { pointerId: 5 });
}

async function drainActions(): Promise<void> {
    await act(() =>
        executeUserAppAction({
            type: 'setDeviceParameter',
            payload: {
                deviceId: 'settlement-device',
                paramId: PARAM_ID,
                value: 20,
                automationRecordingPolicy: 'suppressed',
            },
        })
    );
}

function writes(): typeof engineWrites {
    return engineWrites.filter((write) => write.deviceId === DEVICE_ID);
}

async function committed(value: number, historyDepth = 1): Promise<void> {
    await waitFor(() => {
        expect(rawValues()[PARAM_ID]).toBe(value);
        expect(values()[PARAM_ID]).toBe(value);
        expect(depth()).toBe(historyDepth);
    });
    expect(writes().at(-1)).toMatchObject({ trackId: 'track-1', deviceId: DEVICE_ID, paramId: PARAM_ID, value });
}

function recordMode(mode: 'read' | 'touch' | 'write' | 'latch'): void {
    trackStore.set({
        ...trackStore.value!,
        tracks: trackStore.value!.tracks.map((track) =>
            track.id === 'track-1' ? { ...track, automationMode: mode } : track
        ),
    });
    transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120 });
    automationStore.set({
        lanes: [
            {
                id: 'distortion-ride',
                trackId: 'track-1',
                parameterId: `${DEVICE_ID}:${PARAM_ID}`,
                parameterName: 'Drive',
                points: [],
                objects: [],
                visible: true,
                enabled: true,
                collapsed: false,
                minValue: 0,
                maxValue: 100,
            },
        ],
    });
    settlePendingProjectWritesAndCaptureRevision();
}

async function activateProject(): Promise<void> {
    const transition = runProjectLoadTransaction();
    expect(await transition.prepare()).toBe(true);
    expect(transition.activate()).toBe(true);
}

describe('actual registered Distortion curve through real project and history', () => {
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
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Distortion canvas gesture');
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
        seed();
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState, isPlaying: false });
        const context = new AudioContext();
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

    it('previews a physical canvas drag without changing truth, then commits one undoable drive edit', async () => {
        render(<Layout />);
        const canvas = begin();
        const before = structuredClone(rawValues());
        const revision = settlePendingProjectWritesAndCaptureRevision();
        act(() => {
            move(80, canvas);
            move(60, canvas);
            move(-100, canvas);
            move(-120, canvas);
            move(0, canvas);
        });
        expect(writes().map(({ value }) => value)).toEqual([30, 40, 100, 100, 40]);
        expect(screen.getByRole('slider', { name: 'Drive' })).toHaveAttribute('aria-valuenow', '40');
        expect(settlePendingProjectWritesAndCaptureRevision()).toBe(revision);
        expect(rawValues()).toEqual(before);
        expect(values()).toEqual(before);
        expect(depth()).toBe(0);
        end(canvas);
        fireEvent.lostPointerCapture(canvas, { pointerId: 5 });
        end(canvas);
        await committed(40);
        expect(writes().map(({ value }) => value)).toEqual([30, 40, 100, 100, 40, 40]);
        await act(() => undo());
        expect(rawValues()).toEqual(before);
        expect(values()).toEqual(before);
        expect(writes().at(-1)?.value).toBe(20);
        await act(() => redo());
        expect(rawValues()[PARAM_ID]).toBe(40);
        expect(values()[PARAM_ID]).toBe(40);
        expect(writes().at(-1)?.value).toBe(40);
    });

    it('keeps two curve drags and a later Drive control edit separate', async () => {
        render(<Layout />);
        begin();
        move(80);
        end();
        await committed(30);
        begin();
        move(60);
        end();
        await committed(50, 2);
        fireEvent.keyDown(screen.getByRole('slider', { name: 'Drive' }), { key: 'End' });
        await waitFor(() => expect(depth()).toBe(3));
        await act(() => undo());
        expect(rawValues()[PARAM_ID]).toBe(50);
        await act(() => undo());
        expect(rawValues()[PARAM_ID]).toBe(30);
        await act(() => undo());
        expect(rawValues()[PARAM_ID]).toBe(20);
    });

    it.each([false, true])('restores absent=%s drive field and default after undo', async (absent) => {
        seed(absent);
        const before = structuredClone(rawValues());
        render(<Layout />);
        begin();
        move(80);
        end();
        await committed(30);
        await act(() => undo());
        expect(rawValues()).toEqual(before);
        expect(values()).toEqual(before);
        expect(writes().at(-1)?.value).toBe(20);
        await act(() => redo());
        expect(rawValues()[PARAM_ID]).toBe(30);
    });

    it.each([false, true])('keeps click and returned-to-start edit absent=%s out of history', async (absent) => {
        seed(absent);
        render(<Layout />);
        end();
        begin();
        end();
        expect(writes()).toEqual([]);
        begin();
        move(80);
        move(100);
        end();
        await drainActions();
        expect(Object.hasOwn(rawValues(), PARAM_ID)).toBe(!absent);
        expect(rawValues()[PARAM_ID]).toBe(absent ? undefined : 20);
        expect(depth()).toBe(0);
        expect(writes().map(({ value }) => value)).toEqual([30, 20]);
    });

    it.each(['pointerCancel', 'lostPointerCapture', 'windowBlur', 'hidden', 'unmount', 'nonfinite'])(
        'restores only runtime after %s without a history entry',
        async (finish) => {
            const view = render(<Layout />);
            const canvas = begin();
            move(80, canvas);
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
            end(canvas);
            await drainActions();
            expect(rawValues()[PARAM_ID]).toBe(20);
            expect(values()[PARAM_ID]).toBe(20);
            expect(depth()).toBe(0);
            expect(writes().map(({ value }) => value)).toEqual([30, 20]);
        }
    );

    it('refuses a final when project admission fails and restores its displayed preview', async () => {
        render(<Layout />);
        begin();
        move(80);
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
        await drainActions();
        expect(rawValues()[PARAM_ID]).toBe(20);
        expect(values()[PARAM_ID]).toBe(20);
        expect(depth()).toBe(0);
        expect(writes().map(({ value }) => value)).toEqual([30, 20]);
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
    ])('refuses the queued final after %s changes without overwriting incoming truth', async (change) => {
        render(<Layout displayed={makeDevice()} />);
        const canvas = begin();
        move(80, canvas);
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
                        devices: [{ ...device, parameterValues: { ...device.parameterValues, [PARAM_ID]: 12 } }],
                    };
                } else if (change === 'frozen') {
                    replacement = { ...track, frozen: true };
                } else if (change === 'chain') {
                    replacement = { ...track, devices: [device, { ...makeDevice(), id: 'extra-device' }] };
                } else if (change === 'device-removed') {
                    replacement = { ...track, devices: [] };
                } else if (change === 'same-id-type-successor') {
                    replacement = {
                        ...track,
                        devices: [
                            { ...makeDevice(), type: 'builtin-filter', parameterValues: { 'filter-cutoff': 900 } },
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
                expect(rawValues()[PARAM_ID]).toBe(12);
                expect(writes().at(-1)?.value).toBe(12);
            } else if (change === 'same-id-type-successor') {
                expect(rawValues()).toEqual({ 'filter-cutoff': 900 });
                expect(writes().map(({ value }) => value)).toEqual([30]);
            } else if (change === 'project-epoch') {
                expect(rawValues()[PARAM_ID]).toBe(20);
                expect(writes()).toEqual([]);
            } else if (change === 'device-removed') {
                expect(rawTracks()[0]?.devices).toEqual([]);
                expect(writes().map(({ value }) => value)).toEqual([30]);
            } else {
                expect(rawValues()[PARAM_ID]).toBe(20);
                expect(writes().map(({ value }) => value)).toEqual(change === 'frozen' ? [30, 20] : [30]);
            }
        } finally {
            await act(async () => {
                release.resolve();
                await snapshot;
            });
        }
    });

    it('fences a live preview from a same-ID incoming project', async () => {
        render(<Layout />);
        const canvas = begin();
        move(80, canvas);
        await act(() => activateProject());
        act(() => seed());
        engineWrites.length = 0;
        move(60, canvas);
        end(canvas);
        await drainActions();
        expect(rawValues()[PARAM_ID]).toBe(20);
        expect(depth()).toBe(0);
        expect(writes()).toEqual([]);
    });

    it('retires a drag when its descriptor disappears so a restored target accepts a fresh drag', async () => {
        const view = render(<Layout />);
        const canvas = begin();
        move(80, canvas);
        expect(writes().map(({ value }) => value)).toEqual([30]);
        view.rerender(<Layout driveAvailable={false} />);
        await drainActions();
        expect(rawValues()[PARAM_ID]).toBe(20);
        expect(values()[PARAM_ID]).toBe(20);
        expect(depth()).toBe(0);
        expect(writes().map(({ value }) => value)).toEqual([30, 20]);
        view.rerender(<Layout />);
        begin();
        move(60);
        end();
        await committed(40);
        expect(writes().map(({ value }) => value)).toEqual([30, 20, 40, 40]);
    });

    it.each(['read', 'touch', 'write', 'latch'] as const)(
        'records physical moves at event time in %s mode without a release sample',
        async (mode) => {
            recordMode(mode);
            const recording = vi.spyOn(automationUseCases, 'recordAutomationValue');
            let beat = 1;
            setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => beat });
            render(<Layout />);
            begin();
            for (const [index, clientY] of [80, 50, 40].entries()) {
                beat = index + 1;
                move(clientY);
            }
            expect(writes().map(({ value }) => value)).toEqual([30, 45, 50]);
            const expected: [string, string, number, number][] = [];
            if (mode !== 'read') {
                expected.push(
                    ['track-1', `${DEVICE_ID}:${PARAM_ID}`, 30, 1],
                    ['track-1', `${DEVICE_ID}:${PARAM_ID}`, 45, 2],
                    ['track-1', `${DEVICE_ID}:${PARAM_ID}`, 50, 3]
                );
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
                expect(recording.mock.calls).toEqual(expected);
                expect(rawValues()[PARAM_ID]).toBe(20);
                expect(depth()).toBe(0);
                beat = 19;
                await act(async () => {
                    release.resolve();
                    await snapshot;
                });
                await committed(50);
                await act(() => undo());
                await act(() => redo());
                expect(recording.mock.calls).toEqual(expected);
                stopAutomationRecording(3);
                const expectedPoints: [number, number][] = [];
                if (mode !== 'read') {
                    expectedPoints.push([1, 30], [2, 45], [3, 50]);
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

    it('does not record canceled preview restoration as an automation sample', async () => {
        recordMode('touch');
        const recording = vi.spyOn(automationUseCases, 'recordAutomationValue');
        setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => 2 });
        render(<Layout />);
        const canvas = begin();
        move(80, canvas);
        fireEvent.pointerCancel(canvas, { pointerId: 5 });
        end(canvas);
        await drainActions();
        expect(recording.mock.calls).toEqual([['track-1', `${DEVICE_ID}:${PARAM_ID}`, 30, 2]]);
        expect(writes().map(({ value }) => value)).toEqual([30, 20]);
        expect(depth()).toBe(0);
    });

    it.each([false, true])(
        'reconstructs persisted truth and history with drive initially absent=%s',
        async (absent) => {
            seed(absent);
            const before = structuredClone(rawValues());
            const view = render(<Layout />);
            begin();
            move(80);
            end();
            await committed(30);
            const liveEntry = undoStore.value?.past[0];
            expect(liveEntry).toBeDefined();
            await waitFor(() => expect(sessionStorage.getItem(SESSION_KEY)).toContain(PARAM_ID));
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
            expect(rawValues()[PARAM_ID]).toBe(30);
            expect(values()[PARAM_ID]).toBe(30);
            clearHandlerRegistry();
            registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
            reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
            expect(depth()).toBe(1);
            expect(undoStore.value?.past[0]).not.toBe(liveEntry);
            render(<Layout />);
            await act(() => undo());
            expect(rawValues()).toEqual(before);
            expect(values()).toEqual(before);
            expect(writes().at(-1)?.value).toBe(20);
            await act(() => redo());
            expect(rawValues()[PARAM_ID]).toBe(30);
            expect(values()[PARAM_ID]).toBe(30);
            expect(writes().at(-1)?.value).toBe(30);
        }
    );
});
