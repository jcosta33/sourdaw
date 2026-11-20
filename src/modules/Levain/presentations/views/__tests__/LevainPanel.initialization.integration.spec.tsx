import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { initDeviceStateReconciliation } from '#/app/initDeviceStateReconciliation';
import { initLevainDeviceStateProjectAccess } from '#/app/initLevainDeviceStateProjectAccess';
import { nativeSampleBankKey } from '#/app/nativeSampleBanks';
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
import {
    captureDeviceParameterRuntimeWriteAuthority,
    configureAudioDeviceRuntimeSink,
    mirrorDeviceChainDelta,
    updateDeviceParam,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore, undoStore } from '#/modules/Command/stores';
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
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { levainStore, setLoadedMicPositions } from '../../../stores/levainStore';
import { type MicPositionType } from '../../../models/LevainPatch';
import { type autoLoadLevainSamples as loadSamples } from '../../../useCases/autoLoadSamples';
import { configureLevainDeviceStateProjectAccess } from '../../../useCases/configureLevainDeviceStateProjectAccess';
import { getLevainHandlers } from '../../../useCases/getLevainHandlers';
import { levainBridge } from '../../../useCases/levainParamBridge/levainBridge';
import { registerLevainDevice } from '../../../useCases/levainParamBridge/registerLevainDevice';
import { reconcileLevainDeviceStateFromProject } from '../../../useCases/reconcileLevainDeviceStateFromProject';
import { LevainPanel } from '../LevainPanel';

import type { TrackStoreState } from '#/modules/Arrangement/stores';

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...original,
        captureDeviceParameterRuntimeWriteAuthority: vi.fn(original.captureDeviceParameterRuntimeWriteAuthority),
        mirrorDeviceChainDelta: vi.fn(original.mirrorDeviceChainDelta),
        updateDeviceParam: vi.fn(),
    };
});

const deviceId = 'levain-init';
const saved = {
    version: 1,
    data: { instrumentId: 'cello', currentArticulation: 'pizzicato', disclosureTier: 'basic' },
};
let channel: MessageChannel;
let stopReconciliation: () => void;
let stopProjection: () => void;
const emitNotification = vi.fn(() => Promise.resolve());
const autoLoadLevainSamples = vi.fn<typeof loadSamples>(() => Promise.resolve(null));
const writeNativeBuiltinParameters = vi.fn();

function projectTracks() {
    return getCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>('root')?.tracks.tracks;
}

function projectDevice() {
    return projectTracks()?.[0]?.devices[0];
}

function projectState() {
    return projectDevice()?.deviceState;
}

beforeEach(async () => {
    configureAutomergeStoragePort(null);
    setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
    const transition = runProjectLoadTransaction();
    expect(await transition.prepare()).toBe(true);
    expect(transition.activate()).toBe(true);
    resetCrdtProjectAuthority('Levain initialization integration');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    registerProjectSlotProjections();
    stopReconciliation = initDeviceStateReconciliation();
    stopProjection = setupProjectionBridge();
    vi.mocked(captureDeviceParameterRuntimeWriteAuthority).mockReset();
    vi.mocked(updateDeviceParam).mockReset();
    vi.mocked(mirrorDeviceChainDelta).mockClear();
    emitNotification.mockClear();
    clearUndoHistory();
    agentProjectRepairStateStore.set(null);
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    registerHandlerMap(getLevainHandlers());
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
        autoLoadLevainSamples,
        setLoadedMicPositions,
        writeNativeBuiltinParameters,
        sendNativeLiveMidiControl: vi.fn(() => Promise.resolve(true)),
    });
    autoLoadLevainSamples.mockReset().mockImplementation(() => Promise.resolve(null));
    writeNativeBuiltinParameters.mockClear();
    setNotificationEventBus({ emit: emitNotification, on: vi.fn() });
    configureAudioDeviceRuntimeSink({ nativeSampleBankKey });
});

afterEach(() => {
    cleanup();
    stopReconciliation();
    stopProjection();
    configureAudioDeviceRuntimeSink({});
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

/** Exercise confirmed synchronous writes at the controller boundary without a worklet. */
function installRuntimeWriteFixture() {
    const writes = new Map<string, { value: number; owner: symbol | undefined }>();

    function address(trackId: string, targetId: string, paramId: string): string {
        return JSON.stringify([trackId, targetId, paramId]);
    }

    vi.mocked(captureDeviceParameterRuntimeWriteAuthority).mockImplementation((trackId, targetId, paramId) => {
        const key = address(trackId, targetId, paramId);
        const startingWrite = writes.get(key);
        const owner = Symbol('runtime fixture write owner');
        function isCurrent(): boolean {
            return writes.get(key)?.owner === owner;
        }
        return {
            owner,
            isCurrent,
            canCommit: () => isCurrent() || writes.get(key) === startingWrite,
            release() {
                const write = writes.get(key);
                if (write?.owner === owner) {
                    write.owner = undefined;
                }
            },
        };
    });
    vi.mocked(updateDeviceParam).mockImplementation((trackId, targetId, paramId, value, owner) => {
        writes.set(address(trackId, targetId, paramId), { value, owner });
    });

    return (trackId: string, targetId: string) => writes.get(address(trackId, targetId, 'masterGain'));
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

async function mountIdentityControls() {
    const setParam = vi.fn();
    await registerLevainDevice(deviceId, { setParam, handleCc: vi.fn() }, channel.port1);
    render(<LevainPanel deviceId={deviceId} />);
    setParam.mockClear();
    autoLoadLevainSamples.mockClear();
    writeNativeBuiltinParameters.mockClear();
    return setParam;
}

function selectionButton(name: string): HTMLElement {
    const button = screen
        .getAllByText(name)
        .map((label) => label.closest('button'))
        .find(Boolean);
    if (!button) {
        throw new Error(`Expected a Levain choice labelled ${name}`);
    }
    return button;
}

function editIncomingDevice(edit: (device: NonNullable<ReturnType<typeof projectDevice>>) => void): void {
    mutateCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>({
        id: 'root',
        changeFn: (document) => {
            const device = document.tracks.tracks[0]?.devices[0];
            if (device?.id !== deviceId) {
                throw new Error('Expected the Levain project fixture');
            }
            edit(device);
        },
    });
}

async function chooseLayout(label: 'Basic' | 'Expert'): Promise<void> {
    await act(async () => screen.getByRole('button', { name: label }).click());
}

it('replays the mounted articulation without reloading its bank or rewinding an earlier rename', async () => {
    const expertState = { ...saved, data: { ...saved.data, disclosureTier: 'expert', futureUi: ['preserve', 7] } };
    editIncomingDevice((device) => {
        device.deviceState = expertState;
    });
    const setParam = await mountIdentityControls();
    await executeAppAction({ type: 'renameTrack', payload: { trackId: 'track-2', name: 'Keep this rename' } });
    const selection = selectionButton('Staccato');
    await act(async () => fireEvent.click(selection));

    expect(emitNotification.mock.calls).toEqual([]);
    expect(projectState()?.data).toEqual({ ...expertState.data, currentArticulation: 'staccato' });
    expect(trackStore.value?.tracks[0]?.devices[0]?.deviceState).toEqual(projectState());
    expect(projectDevice()?.parameterValues).toEqual({});
    expect(selection).toHaveAttribute('aria-pressed', 'true');
    expect(setParam.mock.calls).toEqual([['current_articulation', 8]]);
    expect(writeNativeBuiltinParameters.mock.calls).toEqual([['track-1', deviceId, { current_articulation: 8 }]]);
    expect(undoStore.value?.past).toMatchObject([
        { label: expect.stringMatching(/rename/i) },
        { label: 'Select Staccato articulation' },
    ]);

    await act(async () => undo());
    expect(projectState()).toEqual(expertState);
    expect(selection).toHaveAttribute('aria-pressed', 'false');
    expect(projectTracks()?.[1]?.name).toBe('Keep this rename');

    await act(async () => redo());
    expect(selection).toHaveAttribute('aria-pressed', 'true');
    expect(projectState()?.data.currentArticulation).toBe('staccato');
    expect(setParam.mock.calls).toEqual([
        ['current_articulation', 8],
        ['current_articulation', 10],
        ['current_articulation', 8],
    ]);
    expect(writeNativeBuiltinParameters.mock.calls.at(-1)).toEqual(['track-1', deviceId, { current_articulation: 8 }]);
    expect(autoLoadLevainSamples).not.toHaveBeenCalled();
});

it('replays the mounted instrument and coupled parameters, restoring absent keys and the legacy Master', async () => {
    const originalParameters = { master_gain: 0.42, mic0Volume: 0.27, unrelated: 0.31 };
    editIncomingDevice((device) => {
        delete device.deviceState;
        device.parameterValues = originalParameters;
    });
    const setParam = await mountIdentityControls();
    const sibling = projectTracks()?.[1];
    const cellos = selectionButton('Cellos');
    await act(async () => fireEvent.click(cellos));

    expect(emitNotification.mock.calls).toEqual([]);
    expect(cellos).toHaveAttribute('aria-pressed', 'true');
    expect(projectState()?.data).toEqual({ instrumentId: 'cello', currentArticulation: 'sustain' });
    const resetParameters = projectDevice()?.parameterValues;
    expect(resetParameters).toMatchObject({ ...originalParameters, masterGain: 0.8, mic0Volume: 0.8 });
    expect(setParam).toHaveBeenCalledWith('master_gain', 0.8);
    expect(setParam).toHaveBeenCalledWith('mic_0_volume', 0.8);
    expect(setParam.mock.calls.filter(([name]) => name === 'master_gain')).toEqual([['master_gain', 0.8]]);
    expect(mirrorDeviceChainDelta).toHaveBeenCalledTimes(1);
    expect(undoStore.value?.past).toMatchObject([{ label: 'Load Cellos' }]);

    setParam.mockClear();
    await act(async () => undo());
    expect(projectDevice()).not.toHaveProperty('deviceState');
    expect(projectDevice()?.parameterValues).toEqual(originalParameters);
    expect(trackStore.value?.tracks[0]?.devices[0]).toEqual(projectDevice());
    expect(cellos).toHaveAttribute('aria-pressed', 'false');
    expect(setParam).toHaveBeenCalledWith('master_gain', 0.42);
    expect(setParam).toHaveBeenCalledWith('mic_0_volume', 0.27);
    const nativeUndo = vi.mocked(mirrorDeviceChainDelta).mock.calls.at(-1)?.[0];
    expect(nativeUndo?.after.id).toBe('track-1');
    expect(nativeUndo?.after.devices[0]?.parameterValues).toMatchObject({ masterGain: 0.42, mic0Volume: 0.27 });
    expect(nativeUndo?.after.devices[0]).not.toHaveProperty('deviceState');

    await act(async () => redo());
    expect(cellos).toHaveAttribute('aria-pressed', 'true');
    expect(projectDevice()?.parameterValues).toEqual(resetParameters);
    expect(projectTracks()?.[1]).toEqual(sibling);
    expect(autoLoadLevainSamples.mock.calls.map(([, , instrument]) => instrument)).toEqual([
        'cello',
        'violin-1',
        'cello',
    ]);
    expect(mirrorDeviceChainDelta).toHaveBeenCalledTimes(3);
});

it('reflects a simultaneous incoming bank and Master change without persisting instrument defaults', async () => {
    const releaseFrame = holdAnimationFrames();
    const setParam = await mountIdentityControls();
    const history = undoStore.value;
    await act(async () => {
        editIncomingDevice((device) => {
            device.deviceState = { version: 1, data: { instrumentId: 'flute', currentArticulation: 'staccato' } };
            device.parameterValues = { masterGain: 0.34, mic0Volume: 0.27 };
        });
    });
    await act(async () => releaseFrame());

    expect(projectState()?.data.instrumentId).toBe('flute');
    expect(projectDevice()?.parameterValues).toEqual({ masterGain: 0.34, mic0Volume: 0.27 });
    expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual(projectDevice()?.parameterValues);
    expect(levainStore.value?.[deviceId]?.patch).toMatchObject({ instrumentId: 'flute', masterGain: 0.34 });
    expect(setParam.mock.calls.filter(([name]) => name === 'master_gain')).toEqual([['master_gain', 0.34]]);
    expect(writeNativeBuiltinParameters).toHaveBeenCalledWith('track-1', deviceId, { master_gain: 0.34 });
    expect(undoStore.value).toEqual(history);
});

it('undoes and redoes the mounted articulation without changing a later layout or rename', async () => {
    const setParam = await mountIdentityControls();
    await executeAppAction({ type: 'renameTrack', payload: { trackId: 'track-2', name: 'Keep this rename' } });
    await chooseLayout('Expert');
    const articulation = selectionButton('Staccato');
    await act(async () => fireEvent.click(articulation));
    await chooseLayout('Basic');
    expect(projectState()?.data).toEqual({ ...saved.data, currentArticulation: 'staccato' });
    const history = undoHistoryStore.value?.past;
    expect(history?.map(({ label }) => label)).toEqual([
        expect.stringMatching(/rename/i),
        'Select Staccato articulation',
    ]);

    await act(async () => undo());
    expect(projectState()).toEqual(saved);
    expect(trackStore.value?.tracks[0]?.devices[0]?.deviceState).toEqual(saved);
    expect(levainStore.value?.[deviceId]?.uiLevel).toBe(1);
    expect(undoHistoryStore.value?.past).toEqual(history?.slice(0, 1));
    expect(projectTracks()?.[1]?.name).toBe('Keep this rename');
    expect(setParam).toHaveBeenLastCalledWith('current_articulation', 10);

    await act(async () => redo());
    expect(projectState()?.data).toEqual({ ...saved.data, currentArticulation: 'staccato' });
    expect(levainStore.value?.[deviceId]?.uiLevel).toBe(1);
    expect(setParam).toHaveBeenLastCalledWith('current_articulation', 8);
});

it('undoes the first Browse choice and keeps a layout saved afterward', async () => {
    editIncomingDevice((device) => {
        delete device.deviceState;
        device.parameterValues = { master_gain: 0.42 };
    });
    const setParam = await mountIdentityControls();
    await executeAppAction({ type: 'renameTrack', payload: { trackId: 'track-2', name: 'Keep this rename' } });
    await act(async () => fireEvent.click(selectionButton('Cellos')));
    await chooseLayout('Expert');
    await act(async () => {
        editIncomingDevice((device) => {
            device.parameterValues.vendorMix = 0.37;
        });
    });
    const reset = projectDevice();
    expect(reset?.deviceState?.data).toEqual({
        instrumentId: 'cello',
        currentArticulation: 'sustain',
        disclosureTier: 'expert',
    });

    setParam.mockClear();
    await act(async () => undo());
    const layoutOnly = { version: 1, data: { instrumentId: 'violin-1', disclosureTier: 'expert' } };
    expect(projectState()).toEqual(layoutOnly);
    expect(trackStore.value?.tracks[0]?.devices[0]?.deviceState).toEqual(layoutOnly);
    expect(projectDevice()?.parameterValues).toEqual({ master_gain: 0.42, vendorMix: 0.37 });
    expect(levainStore.value?.[deviceId]).toMatchObject({
        uiLevel: 6,
        patch: { instrumentId: 'violin-1', masterGain: 0.42 },
    });
    expect(setParam).toHaveBeenCalledWith('master_gain', 0.42);
    expect(projectTracks()?.[1]?.name).toBe('Keep this rename');

    await act(async () => redo());
    expect(projectDevice()).toEqual(reset);
    expect(levainStore.value?.[deviceId]).toMatchObject({
        uiLevel: 6,
        patch: { instrumentId: 'cello', masterGain: 0.8 },
    });
});

it('saves an initial layout with the default bank and no authored articulation', async () => {
    editIncomingDevice((device) => {
        delete device.deviceState;
    });
    const setParam = await mountIdentityControls();
    await chooseLayout('Expert');

    expect(projectState()).toEqual({ version: 1, data: { instrumentId: 'violin-1', disclosureTier: 'expert' } });
    expect(undoHistoryStore.value?.past).toEqual([]);
    expect(levainStore.value?.[deviceId]?.uiLevel).toBe(6);
    expect(setParam).not.toHaveBeenCalled();
    expect(autoLoadLevainSamples).not.toHaveBeenCalled();
});

it.each(['owned gain', 'unsupported device state'] as const)(
    'keeps a newer %s when a layout-aware Browse Undo conflicts',
    async (newer) => {
        const setParam = await mountIdentityControls();
        await act(async () => fireEvent.click(selectionButton('Flutes')));
        await chooseLayout('Expert');
        await act(async () => {
            editIncomingDevice((device) => {
                if (newer === 'owned gain') {
                    device.parameterValues.masterGain = 0.53;
                } else {
                    device.deviceState = { version: 99, data: { preserve: 'newer reader' } };
                }
            });
        });
        const current = projectDevice();
        const history = undoHistoryStore.value;
        setParam.mockClear();
        await act(async () => undo());
        expect(projectDevice()).toEqual(current);
        expect(trackStore.value?.tracks[0]?.devices[0]).toEqual(current);
        expect(undoHistoryStore.value).toEqual(history);
        expect(setParam).not.toHaveBeenCalled();
        expect(emitNotification).toHaveBeenCalledWith('ui.notify', expect.objectContaining({ level: 'warning' }));
    }
);

it('resets the current bank once and cancels only queued parameters that Browse owns', async () => {
    const releaseFrame = holdAnimationFrames();
    const setParam = await mountIdentityControls();
    act(() => {
        levainBridge().setLevainParamWithAudio(deviceId, 'masterGain', 0.51);
        levainBridge().setLevainParamWithAudio(deviceId, 'releaseTriggers', {
            enabled: false,
            durationScaleMax: 0.32,
            dynamicScale: true,
        });
    });
    await act(async () => fireEvent.click(selectionButton('Cellos')));
    await act(async () => releaseFrame());

    expect(projectDevice()?.parameterValues).toMatchObject({ masterGain: 0.8, releaseTriggersDurationScaleMax: 0.32 });
    expect(projectState()?.data).toEqual({ ...saved.data, currentArticulation: 'sustain' });
    expect(setParam.mock.calls.filter(([name]) => name === 'master_gain')).toEqual([['master_gain', 0.8]]);
    expect(setParam).toHaveBeenCalledWith('release_triggers_duration_scale_max', 0.32);
    expect(autoLoadLevainSamples).not.toHaveBeenCalled();
    expect(mirrorDeviceChainDelta).not.toHaveBeenCalled();
});

it('retires a held Master drag when the instrument changes and the committed gain stays equal', async () => {
    editIncomingDevice((device) => {
        device.parameterValues = { masterGain: 0.8 };
    });
    const master = await mountExpertMaster();
    beginMasterDrag(master);
    expect(master).toHaveAttribute('aria-valuenow', '0.48');
    await act(async () => fireEvent.click(selectionButton('Flutes')));
    expect(projectState()?.data.instrumentId).toBe('flute');
    expect(master).toHaveAttribute('aria-valuenow', '0.8');

    const history = undoStore.value;
    vi.mocked(updateDeviceParam).mockClear();
    fireEvent.pointerMove(master, { pointerId: 1, clientY: 145 });
    await act(async () => fireEvent.pointerUp(master, { pointerId: 1 }));
    expect(projectDevice()?.parameterValues.masterGain).toBe(0.8);
    expect(updateDeviceParam).not.toHaveBeenCalled();
    expect(undoStore.value).toEqual(history);
});

it('keeps refused Browse from changing the frozen device, history or runtime', async () => {
    const setParam = await mountIdentityControls();
    await act(async () => {
        mutateCrdtDoc<{ tracks: Pick<TrackStoreState, 'tracks'> }>({
            id: 'root',
            changeFn: ({ tracks }) => {
                const track = tracks.tracks[0];
                if (!track || track.id !== 'track-1') {
                    throw new Error('Expected the Levain owner');
                }
                track.frozen = true;
            },
        });
    });
    const history = undoStore.value;
    await act(async () => fireEvent.click(selectionButton('Flutes')));
    expect(projectState()).toEqual(saved);
    expect(selectionButton('Cellos')).toHaveAttribute('aria-pressed', 'true');
    expect(setParam).not.toHaveBeenCalled();
    expect(autoLoadLevainSamples).not.toHaveBeenCalled();
    expect(undoStore.value).toEqual(history);
    expect(emitNotification).toHaveBeenCalledWith('ui.notify', expect.objectContaining({ level: 'warning' }));
});

it.each<NonNullable<ReturnType<typeof projectState>>>([
    { version: 99, data: { instrumentId: 'cello', currentArticulation: 'pizzicato', future: 'keep' } },
    { version: 1, data: { instrumentId: 'flute', currentArticulation: 'unrecognized-articulation' } },
    { version: 1, data: { instrumentId: 'unrecognized-instrument', currentArticulation: 'sustain' } },
])('preserves an unsupported saved identity when Browse is attempted', async (original) => {
    editIncomingDevice((device) => {
        device.deviceState = original;
    });
    const setParam = await mountIdentityControls();
    const history = undoStore.value;
    await act(async () => fireEvent.click(selectionButton('Cellos')));
    expect(projectState()).toEqual(original);
    expect(trackStore.value?.tracks[0]?.devices[0]?.deviceState).toEqual(original);
    expect(setParam).not.toHaveBeenCalled();
    expect(autoLoadLevainSamples).not.toHaveBeenCalled();
    expect(undoStore.value).toEqual(history);
    expect(emitNotification).toHaveBeenCalledWith(
        'ui.notify',
        expect.objectContaining({ level: 'warning', message: expect.stringContaining('cannot be edited') })
    );
});

it.each([
    { label: 'Staccato', instrumentId: 'flute', articulation: 'staccato', engineArticulation: 8 },
    { label: 'Cellos', instrumentId: 'cello', articulation: 'sustain', engineArticulation: 0 },
])(
    'accepts $label after a merged cross-bank articulation and restores the exact legacy bytes',
    async ({ label, instrumentId, articulation, engineArticulation }) => {
        const original = {
            version: 1,
            data: {
                instrumentId: 'flute',
                currentArticulation: 'pizzicato',
                disclosureTier: 'expert',
                unowned: 'keep',
            },
        };
        editIncomingDevice((device) => {
            device.deviceState = original;
        });
        const setParam = await mountIdentityControls();
        expect(levainStore.value?.[deviceId]?.patch).toMatchObject({
            instrumentId: 'flute',
            currentArticulation: 'sustain',
        });

        await act(async () => fireEvent.click(selectionButton(label)));
        const changed = { version: 1, data: { ...original.data, instrumentId, currentArticulation: articulation } };
        expect(projectState()).toEqual(changed);
        expect(setParam.mock.calls.filter(([name]) => name === 'current_articulation')).toEqual([
            ['current_articulation', engineArticulation],
        ]);
        const entry = undoHistoryStore.value?.past.at(-1);
        if (entry?.kind !== 'action' || entry.inverseAction?.type !== 'setLevainIdentity') {
            throw new Error('Expected a Levain identity undo entry');
        }
        const { restore, ...untagged } = entry.inverseAction.payload;
        expect(restore).toBe(true);
        expect(getLevainHandlers().setLevainIdentity.validateSessionActionArguments?.(untagged)).toBe(false);

        setParam.mockClear();
        await act(async () => undo());
        expect(projectState()).toEqual(original);
        expect(trackStore.value?.tracks[0]?.devices[0]?.deviceState).toEqual(original);
        expect(levainStore.value?.[deviceId]?.patch).toMatchObject({
            instrumentId: 'flute',
            currentArticulation: 'sustain',
        });
        expect(setParam.mock.calls.filter(([name]) => name === 'current_articulation')).toEqual([
            ['current_articulation', 0],
        ]);

        await act(async () => redo());
        expect(projectState()).toEqual(changed);
        expect(trackStore.value?.tracks[0]?.devices[0]?.deviceState).toEqual(changed);
        expect(levainStore.value?.[deviceId]?.patch).toMatchObject({ instrumentId, currentArticulation: articulation });
    }
);

it('drops a queued Browse request after its registered port is replaced under the same id', async () => {
    const oldSetParam = await mountIdentityControls();
    const held = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const transaction = transactSnapshot(async () => {
        held.resolve();
        await release.promise;
    });
    await held.promise;
    const newChannel = new MessageChannel();
    const newSetParam = vi.fn();
    try {
        await act(async () => {
            fireEvent.click(selectionButton('Flutes'));
            await registerLevainDevice(deviceId, { setParam: newSetParam, handleCc: vi.fn() }, newChannel.port1);
            newSetParam.mockClear();
            autoLoadLevainSamples.mockClear();
            release.resolve();
            await transaction;
        });
        expect(projectState()).toEqual(saved);
        expect(oldSetParam).not.toHaveBeenCalled();
        expect(newSetParam).not.toHaveBeenCalled();
        expect(autoLoadLevainSamples).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    } finally {
        release.resolve();
        newChannel.port1.close();
        newChannel.port2.close();
    }
});

it('aborts a staged Browse patch when its port is replaced before publication', async () => {
    const releaseFrame = holdAnimationFrames();
    const oldSetParam = await mountIdentityControls();
    const newChannel = new MessageChannel();
    const replacement = vi.fn();
    let sawStagedPatch = false;
    const unsubscribe = trackStore.subscribe(() => {
        const device = trackStore.value?.tracks[0]?.devices[0];
        if (sawStagedPatch || device?.deviceState?.data.instrumentId !== 'flute') {
            return;
        }
        sawStagedPatch = true;
        expect(projectState()).toEqual(saved);
        void registerLevainDevice(deviceId, { setParam: replacement, handleCc: vi.fn() }, newChannel.port1);
    });
    try {
        act(() => levainBridge().setLevainParamWithAudio(deviceId, 'masterGain', 0.51));
        await act(async () => fireEvent.click(selectionButton('Flutes')));
        expect(sawStagedPatch).toBe(true);
        expect(projectState()).toEqual(saved);
        expect(trackStore.value?.tracks[0]?.devices[0]?.deviceState).toEqual(saved);
        expect(undoStore.value?.past).toEqual([]);
        expect(oldSetParam).not.toHaveBeenCalled();
        expect(autoLoadLevainSamples.mock.calls.map(([, , instrument]) => instrument)).toEqual(['cello']);

        await act(async () => releaseFrame());
        expect(projectDevice()?.parameterValues).toEqual({ masterGain: 0.51 });
        expect(replacement).toHaveBeenLastCalledWith('master_gain', 0.51);
        expect(mirrorDeviceChainDelta).not.toHaveBeenCalled();
    } finally {
        unsubscribe();
        newChannel.port1.close();
        newChannel.port2.close();
    }
});

it('keeps a new Browse bank and its loaded mic positions after the previous bank finishes late', async () => {
    await mountIdentityControls();
    const flute = Promise.withResolvers<readonly (MicPositionType | null)[]>();
    const trumpet = Promise.withResolvers<readonly (MicPositionType | null)[]>();
    autoLoadLevainSamples.mockImplementation((_id, _port, instrument) =>
        instrument === 'flute' ? flute.promise : trumpet.promise
    );
    await act(async () => fireEvent.click(selectionButton('Flutes')));
    await act(async () => fireEvent.click(selectionButton('Trumpets')));
    expect(autoLoadLevainSamples.mock.calls.map(([, , instrument]) => instrument)).toEqual(['flute', 'trumpet']);
    expect(autoLoadLevainSamples.mock.calls[0]?.[3]?.aborted).toBe(true);

    await act(async () => trumpet.resolve(['room', 'close']));
    await act(async () => flute.resolve(['close']));
    expect(projectState()?.data.instrumentId).toBe('trumpet');
    expect(levainStore.value?.[deviceId]).toMatchObject({
        patch: { instrumentId: 'trumpet' },
        loadedMicPositions: ['room', 'close'],
    });
});

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

it('restores its addressed runtime write when the held Master unmounts', async () => {
    const readRuntime = installRuntimeWriteFixture();
    const master = await mountExpertMaster();
    const history = undoStore.value;
    beginMasterDrag(master);
    const owner = readRuntime('track-1', deviceId)?.owner;
    expect(owner).toEqual(expect.any(Symbol));
    expect(readRuntime('track-1', deviceId)).toEqual({ value: 0.48, owner });
    expect(master).toHaveAttribute('aria-valuenow', '0.48');

    cleanup();
    expect(screen.queryByRole('slider', { name: 'Master' })).toBeNull();
    expect(updateDeviceParam).toHaveBeenLastCalledWith('track-1', deviceId, 'masterGain', 0.8, owner);
    expect(updateDeviceParam).toHaveBeenCalledTimes(2);
    expect(readRuntime('track-1', deviceId)).toEqual({ value: 0.8, owner: undefined });
    expect(projectDevice()?.parameterValues).toEqual({});
    expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual({});
    expect(undoStore.value).toEqual(history);
});

it('restores Master after a preview write throws and accepts the next edit', async () => {
    const readRuntime = installRuntimeWriteFixture();
    const master = await mountExpertMaster();
    const history = undoStore.value;
    beginMasterDrag(master);
    expect(master).toHaveAttribute('aria-valuenow', '0.48');
    expect(readRuntime('track-1', deviceId)?.value).toBe(0.48);
    vi.mocked(updateDeviceParam).mockImplementationOnce(() => {
        throw new Error('Master preview write refused by runtime');
    });

    fireEvent.pointerMove(master, { pointerId: 1, clientY: 145 });
    await act(async () => fireEvent.pointerUp(master, { pointerId: 1 }));
    expect(master).toHaveAttribute('aria-valuenow', '0.8');
    expect(readRuntime('track-1', deviceId)).toEqual({ value: 0.8, owner: undefined });
    expect(updateDeviceParam).toHaveBeenCalledTimes(3);
    expect(projectDevice()?.parameterValues).toEqual({});
    expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual({});
    expect(undoStore.value).toEqual(history);
    expect(emitNotification).toHaveBeenCalledExactlyOnceWith(
        'ui.notify',
        expect.objectContaining({ level: 'error', message: 'Master preview write refused by runtime' })
    );

    await act(async () => fireEvent.keyDown(master, { key: 'ArrowUp' }));
    expect(master).toHaveAttribute('aria-valuenow', '0.81');
    expect(readRuntime('track-1', deviceId)).toEqual({ value: 0.81, owner: undefined });
    expect(projectDevice()?.parameterValues).toEqual({ masterGain: 0.81 });
    expect(undoStore.value?.past).toHaveLength((history?.past.length ?? 0) + 1);
});

it('does not commit a drag returned to the opening Master value', async () => {
    const readRuntime = installRuntimeWriteFixture();
    const master = await mountExpertMaster();
    const history = undoStore.value;
    beginMasterDrag(master);
    expect(master).toHaveAttribute('aria-valuenow', '0.48');
    const owner = readRuntime('track-1', deviceId)?.owner;
    expect(owner).toEqual(expect.any(Symbol));

    fireEvent.pointerMove(master, { pointerId: 1, clientY: 100 });
    expect(master).toHaveAttribute('aria-valuenow', '0.8');
    expect(readRuntime('track-1', deviceId)).toEqual({ value: 0.8, owner });
    await act(async () => fireEvent.pointerUp(master, { pointerId: 1 }));
    expect(readRuntime('track-1', deviceId)).toEqual({ value: 0.8, owner: undefined });
    expect(updateDeviceParam).toHaveBeenCalledTimes(2);
    expect(projectDevice()?.parameterValues).toEqual({});
    expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual({});
    expect(undoStore.value).toEqual(history);
});

it('discards a held preview when a successor registers under the same device id', async () => {
    const readRuntime = installRuntimeWriteFixture();
    const master = await mountExpertMaster();
    beginMasterDrag(master);
    expect(master).toHaveAttribute('aria-valuenow', '0.48');
    expect(readRuntime('track-1', deviceId)?.value).toBe(0.48);

    const successor = { setParam: vi.fn(), handleCc: vi.fn() };
    await act(async () => {
        await registerLevainDevice(deviceId, successor, channel.port2);
        await executeAppAction({ type: 'renameTrack', payload: { trackId: 'track-2', name: 'After replacement' } });
    });
    expect(successor.setParam).toHaveBeenCalledWith('master_gain', 0.8);
    expect(master).toHaveAttribute('aria-valuenow', '0.8');
    const history = undoStore.value;

    fireEvent.pointerMove(master, { pointerId: 1, clientY: 145 });
    await act(async () => fireEvent.pointerUp(master, { pointerId: 1 }));
    expect(updateDeviceParam).toHaveBeenCalledExactlyOnceWith(
        'track-1',
        deviceId,
        'masterGain',
        0.48,
        expect.any(Symbol)
    );
    expect(projectDevice()?.parameterValues).toEqual({});
    expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues).toEqual({});
    expect(undoStore.value).toEqual(history);
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
