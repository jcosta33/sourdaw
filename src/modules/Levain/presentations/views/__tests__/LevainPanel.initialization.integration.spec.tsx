import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { initDeviceStateReconciliation } from '#/app/initDeviceStateReconciliation';
import { initLevainDeviceStateProjectAccess } from '#/app/initLevainDeviceStateProjectAccess';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    defaultTrackState,
    persistDeviceParam,
    resolveEligibleDeviceWriteTarget,
    sanitizeTrackSnapshot,
    trackStore,
} from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { levainStore } from '../../../stores/levainStore';
import { configureLevainDeviceStateProjectAccess } from '../../../useCases/configureLevainDeviceStateProjectAccess';
import { levainBridge } from '../../../useCases/levainParamBridge/levainBridge';
import { registerLevainDevice } from '../../../useCases/levainParamBridge/registerLevainDevice';
import { reconcileLevainDeviceStateFromProject } from '../../../useCases/reconcileLevainDeviceStateFromProject';
import { LevainPanel } from '../LevainPanel';

import type { TrackStoreState } from '#/modules/Arrangement/stores';

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: vi.fn(),
}));

const deviceId = 'levain-init';
const saved = {
    version: 1,
    data: { instrumentId: 'cello', currentArticulation: 'pizzicato', disclosureTier: 'basic' },
};
let channel: MessageChannel;
let stopReconciliation: () => void;
let stopProjection: () => void;
const emitNotification = vi.fn(() => Promise.resolve());

function projectTracks() {
    return getCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>('root')?.tracks.tracks;
}

function projectDevice() {
    return projectTracks()?.[0]?.devices[0];
}

function projectState() {
    return projectDevice()?.deviceState;
}

beforeEach(() => {
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('Levain initialization integration');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    registerProjectSlotProjections();
    stopReconciliation = initDeviceStateReconciliation();
    stopProjection = setupProjectionBridge();
    vi.mocked(updateDeviceParam).mockClear();
    emitNotification.mockClear();
    clearUndoHistory();
    agentProjectRepairStateStore.set(null);
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    initLevainDeviceStateProjectAccess();
    const tracks = sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Cello',
                kind: 'midi',
                devices: [
                    {
                        id: deviceId,
                        name: 'Levain',
                        type: 'levain',
                        bypassed: false,
                        parameterValues: {},
                        deviceState: saved,
                    },
                ],
            },
            {
                id: 'track-2',
                name: 'Other instrument',
                kind: 'midi',
                devices: [
                    {
                        id: 'levain-other',
                        name: 'Second Levain',
                        type: 'levain',
                        bypassed: false,
                        parameterValues: { masterGain: 0.37 },
                    },
                ],
            },
        ],
        selectedTrackId: null,
    }).tracks;
    trackStore.set({ ...defaultTrackState, tracks });
    flushAutomergeStorageWrites();
    levainStore.set({});
    channel = new MessageChannel();
    injectDependencies(levainBridge, {
        persistDeviceParam,
        resolveEligibleDeviceWriteTarget,
        autoLoadLevainSamples: vi.fn(() => Promise.resolve(null)),
        setLoadedMicPositions: vi.fn(),
        writeNativeBuiltinParameters: vi.fn(),
        sendNativeLiveMidiControl: vi.fn(() => Promise.resolve(true)),
    });
    setNotificationEventBus({ emit: emitNotification, on: vi.fn() });
});

afterEach(() => {
    cleanup();
    stopReconciliation();
    stopProjection();
    vi.unstubAllGlobals();
    configureLevainDeviceStateProjectAccess(null);
    trackStore.set({ ...defaultTrackState, tracks: [] });
    flushAutomergeStorageWrites();
    levainStore.set({});
    removeCrdtDoc('root');
    configureAutomergeStoragePort(null);
    channel.port1.close();
    channel.port2.close();
});

async function mountExpertMaster() {
    await registerLevainDevice(deviceId, { setParam: vi.fn(), handleCc: vi.fn() }, channel.port1);
    render(<LevainPanel deviceId={deviceId} />);
    await act(async () => screen.getByRole('button', { name: 'Expert' }).click());
    await waitFor(() => expect(projectState()?.data.disclosureTier).toBe('expert'));
    const master = await screen.findByRole('slider', { name: 'Master' });
    Object.defineProperties(master, {
        setPointerCapture: { value: vi.fn() },
        releasePointerCapture: { value: vi.fn() },
    });
    return master;
}

function beginMasterDrag(master: HTMLElement): void {
    fireEvent.pointerDown(master, { button: 0, pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(master, { pointerId: 1, clientY: 124 });
}

function holdAnimationFrames(): () => void {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    return () => {
        for (const callback of frames.splice(0)) {
            callback(0);
        }
        flushAutomergeStorageWrites();
    };
}

it('previews Desk Master across animation frames and commits one replayable canonical scalar on release', async () => {
    const releaseFrame = holdAnimationFrames();
    const master = await mountExpertMaster();
    await act(async () => {
        await executeAppAction({ type: 'renameTrack', payload: { trackId: 'track-2', name: 'Name before drag' } });
    });
    const historyBefore = undoStore.value?.past;
    expect(master).toHaveAttribute('aria-valuenow', '0.8');
    expect(projectDevice()?.parameterValues).not.toHaveProperty('masterGain');

    beginMasterDrag(master);
    expect(master).toHaveAttribute('aria-valuenow', '0.48');
    await act(async () => releaseFrame());

    expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).not.toHaveProperty('masterGain');
    expect(projectDevice()?.parameterValues).not.toHaveProperty('masterGain');
    expect(undoStore.value?.past).toEqual(historyBefore);
    expect(levainStore.value?.[deviceId]?.patch.masterGain).toBe(0.8);
    expect(updateDeviceParam).toHaveBeenCalledExactlyOnceWith(
        'track-1',
        deviceId,
        'masterGain',
        0.48,
        expect.any(Symbol)
    );

    await act(async () => fireEvent.pointerUp(master, { pointerId: 1 }));
    expect(projectDevice()?.parameterValues).toEqual({ masterGain: 0.48 });
    expect(undoStore.value?.past).toHaveLength((historyBefore?.length ?? 0) + 1);
    expect(levainStore.value?.[deviceId]?.patch.masterGain).toBe(0.48);
    expect(updateDeviceParam).toHaveBeenCalledTimes(2);

    await act(async () => undo());
    expect(projectDevice()?.parameterValues).toEqual({});
    expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).not.toHaveProperty('masterGain');
    expect(master).toHaveAttribute('aria-valuenow', '0.8');
    expect(updateDeviceParam).toHaveBeenLastCalledWith('track-1', deviceId, 'masterGain', 0.8);
    expect(updateDeviceParam).toHaveBeenCalledTimes(3);
    expect(projectTracks()?.[1]).toMatchObject({
        name: 'Name before drag',
        devices: [{ id: 'levain-other', parameterValues: { masterGain: 0.37 } }],
    });

    await act(async () => redo());
    expect(projectDevice()?.parameterValues).toEqual({ masterGain: 0.48 });
    expect(master).toHaveAttribute('aria-valuenow', '0.48');
    expect(updateDeviceParam).toHaveBeenLastCalledWith('track-1', deviceId, 'masterGain', 0.48);
    expect(updateDeviceParam).toHaveBeenCalledTimes(4);
    expect(projectState()?.data).toMatchObject({ instrumentId: 'cello', currentArticulation: 'pizzicato' });
});

it('lets an existing queued Master edit and mic edit settle when Desk Master is pressed', async () => {
    const releaseFrame = holdAnimationFrames();
    const master = await mountExpertMaster();
    act(() => {
        levainBridge().setLevainParamWithAudio(deviceId, 'masterGain', 0.62);
        levainBridge().sendMicParamToEngine(deviceId, 0, 'volume', 0.33);
    });
    await act(async () => {
        await executeAppAction({ type: 'renameTrack', payload: { trackId: 'track-2', name: 'While queued' } });
    });
    expect(master).toHaveAttribute('aria-valuenow', '0.62');

    beginMasterDrag(master);
    await act(async () => fireEvent.pointerUp(master, { pointerId: 1 }));
    expect(master).toHaveAttribute('aria-valuenow', '0.62');
    expect(updateDeviceParam).not.toHaveBeenCalled();
    await act(async () => releaseFrame());
    expect(projectDevice()?.parameterValues).toEqual({ masterGain: 0.62, mic0Volume: 0.33 });
    expect(master).toHaveAttribute('aria-valuenow', '0.62');
});

it('retires an old drag after a different committed Master value arrives', async () => {
    const master = await mountExpertMaster();
    beginMasterDrag(master);
    expect(master).toHaveAttribute('aria-valuenow', '0.48');
    await act(async () => {
        await executeAppAction({ type: 'renameTrack', payload: { trackId: 'track-2', name: 'While holding' } });
    });
    expect(master).toHaveAttribute('aria-valuenow', '0.48');
    await act(async () => {
        await executeAppAction({
            type: 'setDeviceParameter',
            payload: { deviceId, paramId: 'masterGain', value: 0.64 },
        });
    });
    expect(master).toHaveAttribute('aria-valuenow', '0.64');
    const historyBeforeRelease = undoStore.value?.past;
    vi.mocked(updateDeviceParam).mockClear();
    fireEvent.pointerMove(master, { pointerId: 1, clientY: 145 });
    await act(async () => fireEvent.pointerUp(master, { pointerId: 1 }));
    expect(projectDevice()?.parameterValues).toEqual({ masterGain: 0.64 });
    expect(master).toHaveAttribute('aria-valuenow', '0.64');
    expect(undoStore.value?.past).toEqual(historyBeforeRelease);
    expect(updateDeviceParam).not.toHaveBeenCalled();
});

it.each<{ caseName: string; legacy: Record<string, number>; effectiveValue: number }>([
    { caseName: 'retained', legacy: { master_gain: 0.42 }, effectiveValue: 0.42 },
    { caseName: 'changed', legacy: { master_gain: 0.55 }, effectiveValue: 0.55 },
    { caseName: 'removed', legacy: {}, effectiveValue: 0.8 },
])('replays the current Master when the legacy value was $caseName', async ({ legacy, effectiveValue }) => {
    const tracks = trackStore.value;
    if (!tracks) {
        throw new Error('Expected the Levain project fixture');
    }
    trackStore.set({
        ...tracks,
        tracks: tracks.tracks.map((track) => ({
            ...track,
            devices: track.devices.map((device) =>
                device.id === deviceId ? { ...device, parameterValues: { master_gain: 0.42 } } : device
            ),
        })),
    });
    flushAutomergeStorageWrites();
    const master = await mountExpertMaster();
    expect(master).toHaveAttribute('aria-valuenow', '0.42');

    await act(async () => fireEvent.keyDown(master, { key: 'ArrowUp' }));
    expect(projectDevice()?.parameterValues).toEqual({ master_gain: 0.42, masterGain: 0.43 });
    expect(updateDeviceParam).toHaveBeenCalledExactlyOnceWith(
        'track-1',
        deviceId,
        'masterGain',
        0.43,
        expect.any(Symbol)
    );
    const historyBefore = undoStore.value?.past;
    await act(async () => {
        mutateCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>({
            id: 'root',
            changeFn: (document) => {
                const device = document.tracks.tracks[0]?.devices[0];
                if (device?.id !== deviceId) {
                    throw new Error('Expected the Levain project fixture');
                }
                device.parameterValues = { ...legacy, masterGain: 0.43 };
            },
        });
    });
    expect(projectDevice()?.parameterValues).toEqual({ ...legacy, masterGain: 0.43 });
    expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual({ ...legacy, masterGain: 0.43 });
    expect(master).toHaveAttribute('aria-valuenow', '0.43');
    expect(undoStore.value?.past).toEqual(historyBefore);

    await act(async () => undo());
    expect(projectDevice()?.parameterValues).toEqual(legacy);
    expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual(legacy);
    expect(master).toHaveAttribute('aria-valuenow', String(effectiveValue));
    expect(updateDeviceParam).toHaveBeenLastCalledWith('track-1', deviceId, 'masterGain', effectiveValue);
    expect(updateDeviceParam).toHaveBeenCalledTimes(2);
});

it('invalidates the held gesture when its owner freezes', async () => {
    const master = await mountExpertMaster();
    beginMasterDrag(master);
    expect(master).toHaveAttribute('aria-valuenow', '0.48');
    const historyBefore = undoStore.value?.past;
    const tracks = trackStore.value;
    if (!tracks) {
        throw new Error('Expected the Levain project fixture');
    }
    await act(async () => {
        trackStore.set({
            ...tracks,
            tracks: tracks.tracks.map((track) => (track.id === 'track-1' ? { ...track, frozen: true } : track)),
        });
        flushAutomergeStorageWrites();
    });
    expect(master).toHaveAttribute('aria-valuenow', '0.8');

    fireEvent.pointerMove(master, { pointerId: 1, clientY: 145 });
    await act(async () => fireEvent.pointerUp(master, { pointerId: 1 }));
    expect(projectDevice()?.parameterValues).toEqual({});
    expect(undoStore.value?.past).toEqual(historyBefore);
    expect(updateDeviceParam).toHaveBeenCalledExactlyOnceWith(
        'track-1',
        deviceId,
        'masterGain',
        0.48,
        expect.any(Symbol)
    );
});

it('clears the held display when project admission refuses a release', async () => {
    const master = await mountExpertMaster();
    beginMasterDrag(master);
    expect(master).toHaveAttribute('aria-valuenow', '0.48');
    const historyBefore = undoStore.value?.past;
    act(() => {
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'repair-required-test',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });
    });
    await act(async () => fireEvent.pointerUp(master, { pointerId: 1 }));
    expect(master).toHaveAttribute('aria-valuenow', '0.8');
    expect(projectDevice()?.parameterValues).toEqual({});
    expect(undoStore.value?.past).toEqual(historyBefore);
    expect(emitNotification).toHaveBeenCalledExactlyOnceWith(
        'ui.notify',
        expect.objectContaining({ level: 'warning' })
    );
});

it('exposes family filters as checked radios without pressed-button semantics', () => {
    render(<LevainPanel deviceId={deviceId} />);
    const familyFilters = screen.getByRole('radiogroup', { name: 'Filter instruments by family' });
    const all = within(familyFilters).getByRole('radio', { name: 'All' });
    const strings = within(familyFilters).getByRole('radio', { name: 'Strings' });

    expect(all).toHaveAttribute('aria-checked', 'true');
    expect(all).not.toHaveAttribute('aria-pressed');
    expect(strings).toHaveAttribute('aria-checked', 'false');
    expect(strings).not.toHaveAttribute('aria-pressed');
});

it('admits layout choices only after registration, even while the engine is loading', async () => {
    render(<LevainPanel deviceId={deviceId} />);
    const group = screen.getByRole('group', { name: 'Levain control detail' });
    const basic = within(group).getByRole('button', { name: 'Basic' });
    const expert = within(group).getByRole('button', { name: 'Expert' });
    expect(basic).toBeDisabled();
    expect(expert).toBeDisabled();
    expert.click();
    expect(projectState()).toEqual(saved);

    await act(async () => {
        await registerLevainDevice(deviceId, { setParam: vi.fn(), handleCc: vi.fn() }, channel.port1);
    });
    expect(levainStore.value?.[deviceId]?.engineReady).toBe(false);
    expect(basic).toBeEnabled();
    expect(expert).toBeEnabled();
    await act(async () => {
        expert.click();
    });
    await waitFor(() => expect(projectState()?.data.disclosureTier).toBe('expert'));
    expect(projectState()?.data).toMatchObject({ instrumentId: 'cello', currentArticulation: 'pizzicato' });
    act(() => reconcileLevainDeviceStateFromProject(deviceId));
    expect(expert).toHaveAttribute('aria-pressed', 'true');
    expect(levainStore.value?.[deviceId]?.patch).toMatchObject({
        instrumentId: 'cello',
        currentArticulation: 'pizzicato',
    });
});
