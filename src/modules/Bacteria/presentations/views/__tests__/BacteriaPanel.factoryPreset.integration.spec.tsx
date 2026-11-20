import { isDeepStrictEqual } from 'node:util';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Device, type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { audioEngine, initEngineDeviceCollaborators } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { toBacteriaModAssignmentsState } from '../../../models/BacteriaModAssignmentsState';
import { mapBacteriaModAssignments } from '../../../models/BacteriaModulationIds';
import { type BacteriaModAssignment } from '../../../models/BacteriaPatch';
import { bacteriaStore, getBacteriaState } from '../../../stores/bacteriaStore';
import { paramBatcher } from '../../../useCases/bacteriaParamBridge/helpers';
import { selectBacteriaFactoryPreset } from '../../../useCases/bacteriaParamBridge/selectBacteriaFactoryPreset';
import { setBacteriaBandParamWithAudio } from '../../../useCases/bacteriaParamBridge/setBacteriaBandParamWithAudio';
import { getBacteriaHandlers } from '../../../useCases/getBacteriaHandlers';
import { initBacteriaModAssignmentsPersistence } from '../../../useCases/initBacteriaModAssignmentsPersistence';
import { BacteriaPanel } from '../BacteriaPanel';

const TRACK = 'guitar';
const DEVICE = 'bacteria-guitar';
const SENTINEL = 'bacteria-sentinel';
const BITCRUSH = 'bac-bitcrush-cascade';
const ROWS: BacteriaModAssignment[] = [{ sourceId: 'macro1', targetParam: 'band0_gain', amount: 0.4, bipolar: false }];

const scalar = vi.fn<(trackId: string, deviceId: string, key: string, value: number) => void>();
const patch = vi.fn<(trackId: string, deviceId: string, values: Record<string, unknown>) => void>();
let stopPersistence: () => void;

function watchAudioEngine(): void {
    const wire = vi.spyOn(audioEngine, 'setUseCaseDeviceCollaborators');
    initEngineDeviceCollaborators();
    const collaborators = wire.mock.calls[0]?.[0];
    if (!collaborators) {
        throw new Error('Expected the AudioEngine parameter receipt wiring');
    }
    vi.spyOn(audioEngine, 'updateDeviceParam').mockImplementation((trackId, deviceId, key, value) => {
        const complete = collaborators.captureParameterWriteReceipt(trackId, deviceId, key).begin();
        scalar(trackId, deviceId, key, value);
        complete();
    });
    vi.spyOn(audioEngine, 'updateDevicePatch').mockImplementation(patch);
}

function device(id: string, parameterValues: Device['parameterValues']): Device {
    return { id, type: 'bacteria', name: 'Bacteria', bypassed: false, parameterValues };
}

function seedDevices(rows: BacteriaModAssignment[] | null, parameterValues: Device['parameterValues'] = {}): void {
    const owner = createTrack({ id: TRACK, name: 'Guitar', kind: 'audio' });
    const target = device(DEVICE, {
        bandCount: 1,
        inputGain: 2,
        bitDepth: 11,
        band4_bitDepth: 13,
        crossoverFreq4: 7100,
        ...parameterValues,
    });
    if (rows !== null) {
        const chunk = toBacteriaModAssignmentsState(rows);
        target.deviceState = { ...chunk, data: { ...chunk.data, exportMetadata: { label: 'Guitar' } } };
    }
    trackStore.set({
        tracks: [{ ...owner, devices: [target, device(SENTINEL, { mix: 0.42 })] }],
        selectedTrackId: TRACK,
        ghostClips: [],
    });
    flushAutomergeStorageWrites();
}

function rawDevice(id = DEVICE): Device {
    flushAutomergeStorageWrites();
    const root = getCrdtDoc<{ tracks: { tracks: Track[] } }>('root');
    const value = root?.tracks.tracks[0]?.devices.find((candidate) => candidate.id === id);
    if (!value) {
        throw new Error('Expected the Bacteria device in the project');
    }
    return structuredClone(value);
}

function projectedDevice(): Device | undefined {
    return trackStore.value?.tracks[0]?.devices.find((candidate) => candidate.id === DEVICE);
}

function undoDepth(): number {
    return undoStore.value?.past.length ?? 0;
}

function publishPeerBitDepth(transaction: object): void {
    mutateCrdtDoc<{ tracks: { tracks: Track[] } }>({
        id: 'root',
        snapshotTransaction: transaction,
        changeFn: (doc) => {
            const target = doc.tracks.tracks[0]?.devices.find(({ id }) => id === DEVICE);
            if (!target) {
                throw new Error('Expected the Bacteria device before the peer write');
            }
            target.parameterValues.band2_bitDepth = 9;
        },
    });
    trackStore.hydrate({ keepLocalRuntimeState: true });
}

describe('Bacteria factory preset history', () => {
    beforeEach(async () => {
        scalar.mockClear();
        patch.mockClear();
        setNotificationEventBus(
            createEventBus<{ 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload }>()
        );
        watchAudioEngine();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        const project = runProjectLoadTransaction();
        expect(await project.prepare()).toBe(true);
        expect(project.activate()).toBe(true);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Bacteria factory preset');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getBacteriaHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        bacteriaStore.set({});
        seedDevices(ROWS);
        stopPersistence = initBacteriaModAssignmentsPersistence();
    });

    afterEach(() => {
        cleanup();
        stopPersistence();
        audioEngine.setUseCaseDeviceCollaborators(null);
        vi.restoreAllMocks();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        bacteriaStore.set({});
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('undos and redoes Bitcrush Cascade separately from the preceding Input edit', async () => {
        const initial = rawDevice();
        const sentinel = rawDevice(SENTINEL);
        render(<BacteriaPanel deviceId={DEVICE} />);

        const input = screen.getByRole('slider', { name: 'Input' });
        fireEvent.keyDown(input, { key: 'ArrowUp' });
        await waitFor(() => expect(undoDepth()).toBe(1));
        const before = rawDevice();
        expect(before.parameterValues).toHaveProperty('inputGain', 2.5);
        expect(before.parameterValues).not.toHaveProperty('band2_bitDepth');
        patch.mockClear();
        scalar.mockClear();

        fireEvent.click(screen.getByRole('button', { name: /Bitcrush Cascade/ }));
        await waitFor(() => expect(rawDevice().parameterValues).toHaveProperty('band2_bitDepth', 4));
        expect(undoDepth()).toBe(2);
        const factory = rawDevice();
        expect(factory.parameterValues).toMatchObject({
            bandCount: 3,
            crossoverFreq1: 400,
            crossoverFreq2: 4000,
            crossoverFreq4: 7100,
            band0_bitDepth: 12,
            band1_bitDepth: 8,
            band2_bitDepth: 4,
            bitDepth: 11,
            band4_bitDepth: 13,
            inputGain: 0,
        });
        expect(projectedDevice()).toEqual(factory);
        expect(factory.deviceState?.data).toEqual({ modAssignments: [], exportMetadata: { label: 'Guitar' } });
        expect(getBacteriaState(DEVICE).patch.name).toBe('Bitcrush Cascade');
        expect(patch).toHaveBeenCalledExactlyOnceWith(TRACK, DEVICE, expect.objectContaining({ modAssignments: [] }));
        expect(scalar).not.toHaveBeenCalledWith(TRACK, DEVICE, 'crossoverFreq4', expect.any(Number));
        patch.mockClear();

        await act(undo);
        expect(rawDevice()).toEqual(before);
        expect(projectedDevice()).toEqual(before);
        expect(getBacteriaState(DEVICE).patch.bands[2]?.bitDepth).toBe(11);
        expect(getBacteriaState(DEVICE).patch.name).toBe('Init');
        expect(scalar).toHaveBeenCalledWith(TRACK, DEVICE, 'band2_bitDepth', 11);
        expect(patch).toHaveBeenCalledExactlyOnceWith(
            TRACK,
            DEVICE,
            expect.objectContaining({ modAssignments: mapBacteriaModAssignments(ROWS) })
        );

        await act(undo);
        expect(rawDevice()).toEqual(initial);
        await act(redo);
        expect(rawDevice()).toEqual(before);
        patch.mockClear();
        await act(redo);
        expect(rawDevice()).toEqual(factory);
        expect(projectedDevice()).toEqual(factory);
        expect(rawDevice(SENTINEL)).toEqual(sentinel);
        expect(patch).toHaveBeenCalledExactlyOnceWith(TRACK, DEVICE, expect.objectContaining({ modAssignments: [] }));
        expect(scalar).not.toHaveBeenCalledWith(TRACK, SENTINEL, expect.any(String), expect.any(Number));
    });

    it.each([
        { rows: null, representation: 'absent' },
        { rows: [], representation: 'explicitly empty' },
    ])('preserves an $representation routing table across factory replay', async ({ rows }) => {
        seedDevices(rows);
        const original = rawDevice();

        await selectBacteriaFactoryPreset(DEVICE, BITCRUSH);
        expect(undoDepth()).toBe(1);
        const factory = rawDevice();
        expect(Object.hasOwn(factory, 'deviceState')).toBe(rows !== null);
        expect(factory.deviceState).toEqual(original.deviceState);
        expect(patch).toHaveBeenCalledExactlyOnceWith(TRACK, DEVICE, expect.objectContaining({ modAssignments: [] }));

        await undo();
        expect(rawDevice()).toEqual(original);
        await redo();
        expect(rawDevice()).toEqual(factory);
    });

    it('refuses a captured factory patch when a peer writes one of its leaves before admission', async () => {
        const original = rawDevice();
        const entered = Promise.withResolvers<void>();
        const resume = Promise.withResolvers<void>();
        const snapshot = transactSnapshot(async (transaction) => {
            entered.resolve();
            await resume.promise;
            publishPeerBitDepth(transaction);
        });
        await entered.promise;

        const selection = selectBacteriaFactoryPreset(DEVICE, BITCRUSH);
        resume.resolve();
        await snapshot;
        await selection;

        const expected = { ...original, parameterValues: { ...original.parameterValues, band2_bitDepth: 9 } };
        expect(rawDevice()).toEqual(expected);
        expect(projectedDevice()).toEqual(expected);
        expect(undoDepth()).toBe(0);
        expect(getBacteriaState(DEVICE).patch.name).toBe('Init');
        expect(scalar).not.toHaveBeenCalled();
        expect(patch).not.toHaveBeenCalled();
    });

    it.each([
        { scenario: 'an otherwise different patch', repeat: false, undoDelta: 1 },
        { scenario: 'an already-selected patch', repeat: true, undoDelta: 0 },
    ])('retires a pending target frame when selecting $scenario', async ({ repeat, undoDelta }) => {
        if (repeat) {
            await selectBacteriaFactoryPreset(DEVICE, BITCRUSH);
        } else {
            seedDevices(ROWS, { band0_bitDepth: 12 });
        }
        const initialDepth = undoDepth();
        const original = rawDevice();
        expect(original.parameterValues).toHaveProperty('band0_bitDepth', 12);
        scalar.mockClear();
        patch.mockClear();
        const frames = new Map<number, FrameRequestCallback>();
        let frameId = 0;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frameId += 1;
            frames.set(frameId, callback);
            return frameId;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
        try {
            setBacteriaBandParamWithAudio(DEVICE, 0, 'bitDepth', 9);
            setBacteriaBandParamWithAudio(SENTINEL, 0, 'bitDepth', 7);
            expect(paramBatcher.pendingSize).toBe(2);

            await selectBacteriaFactoryPreset(DEVICE, BITCRUSH);
            expect(undoDepth()).toBe(initialDepth + undoDelta);
            for (const frame of frames.values()) {
                frame(0);
            }

            const target = rawDevice();
            expect(target.parameterValues).toHaveProperty('band0_bitDepth', 12);
            expect(isDeepStrictEqual(target, original)).toBe(repeat);
            expect(getBacteriaState(DEVICE).patch.bands[0]?.bitDepth).toBe(12);
            expect(scalar).toHaveBeenCalledWith(TRACK, DEVICE, 'band0_bitDepth', 12);
            expect(scalar).not.toHaveBeenCalledWith(TRACK, DEVICE, 'band0_bitDepth', 9);
            expect(rawDevice(SENTINEL).parameterValues).toHaveProperty('band0_bitDepth', 7);
        } finally {
            paramBatcher.cancelAll();
            vi.unstubAllGlobals();
        }
    });
});
