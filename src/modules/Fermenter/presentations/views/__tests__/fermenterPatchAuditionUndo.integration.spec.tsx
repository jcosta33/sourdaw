import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    persistDeviceParam,
    resolveEligibleDeviceWriteTarget,
    type Track,
    trackStore,
} from '#/modules/Arrangement/stores';
import {
    clampDeviceParameterValue,
    createTrack,
    getArrangementHandlers,
    persistDevicePatch,
} from '#/modules/Arrangement/useCases';
import { leaveSession } from '#/modules/Collaboration/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { actionHistoryStore, agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { DEFAULT_PATCH, type FermenterPatch } from '../../../models/FermenterPatch';
import {
    cloneFermenterPatch,
    fromFermenterDeviceState,
    toFermenterDeviceState,
} from '../../../models/FermenterPatchState';
import { fermenterStore, getFermenterState, loadFermenterPatch } from '../../../stores/fermenterStore';
import { commitFermenterPatch } from '../../../useCases/commitFermenterPatch';
import { loadFermenterPatchWithAudio } from '../../../useCases/fermenterParamBridge/loadFermenterPatchWithAudio';
import { setFermenterParamWithAudio } from '../../../useCases/fermenterParamBridge/setFermenterParamWithAudio';
import { hydrateFermenterFromProject } from '../../../useCases/hydrateFermenterFromProject';
import { resolveFermenterPresetPatch } from '../../../useCases/fermenterPatchOperations';
import { applyMorphedPatch } from '../../../useCases/presetMorph/applyMorphedPatch';
import { setFermenterDependencies } from '../../../useCases/fermenterDependencies';
import { FERMENTER_PRESETS } from '../../../useCases/fermenterQueries/helpers';
import { getFermenterHandlers } from '../../../useCases/getFermenterHandlers';
import { FermenterPanel } from '../FermenterPanel';

const audio = vi.hoisted(() => ({
    updateDeviceParam: vi.fn<(trackId: string, deviceId: string, paramId: string, value: number) => void>(),
    updateDevicePatch: vi.fn<(trackId: string, deviceId: string, patch: Record<string, unknown>) => void>(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: audio.updateDeviceParam,
    updateDevicePatch: audio.updateDevicePatch,
}));

const DEVICE_ID = 'fermenter-audition';
const OTHER_DEVICE_ID = 'fermenter-other';
const TRACK_ID = 'fermenter-audition-track';

function projectedTrack(): Track {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID);
    if (!track) {
        throw new Error('Expected the Fermenter track projection');
    }
    return track;
}

function rawDevice(deviceId = DEVICE_ID) {
    const document = getCrdtDoc<{ tracks: { tracks: Track[] } }>('root');
    const device = document?.tracks.tracks
        .find((track) => track.id === TRACK_ID)
        ?.devices.find((candidate) => candidate.id === deviceId);
    if (!device) {
        throw new Error('Expected the committed Fermenter device');
    }
    return device;
}

function committedPatch(deviceId = DEVICE_ID): FermenterPatch {
    const patch = fromFermenterDeviceState(rawDevice(deviceId).deviceState);
    if (!patch) {
        throw new Error('Expected a committed whole Fermenter patch');
    }
    return patch;
}

function depth(): number {
    return undoStore.value?.past.length ?? 0;
}

function renderPanel(deviceId = DEVICE_ID): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <FermenterPanel deviceId={deviceId} />
        </QueryClientProvider>
    );
}

function replaceTrack(track: Track): void {
    trackStore.set({ tracks: [track], selectedTrackId: TRACK_ID, ghostClips: [] });
}

async function activateProject(): Promise<void> {
    const transition = runProjectLoadTransaction();
    expect(await transition.prepare()).toBe(true);
    expect(transition.activate()).toBe(true);
}

async function holdSnapshot() {
    const entered = Promise.withResolvers<object>();
    const release = Promise.withResolvers<void>();
    const snapshot = transactSnapshot(async (transaction) => {
        entered.resolve(transaction);
        await release.promise;
    });
    const transaction = await entered.promise;
    return {
        change(callback: () => void) {
            const write = runWithAutomergeStorageTransaction(transaction, callback);
            if (write.status === 'threw') {
                throw write.error;
            }
            write.commit();
        },
        async finish() {
            release.resolve();
            await snapshot;
        },
    };
}

function patchNamed(name: string, filterCutoff: number): FermenterPatch {
    const patch = cloneFermenterPatch({ ...DEFAULT_PATCH, name, filterCutoff });
    patch.macros = [0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 0.77, 0.88];
    patch.macroMappings![0]!.targets[0]!.center = filterCutoff + 123;
    patch.macroMappings![3]!.targets[1]!.depth = 0.41;
    return patch;
}

async function commit(patch: FermenterPatch, label = 'Audition preset'): Promise<boolean> {
    let result = false;
    await act(async () => {
        result = await commitFermenterPatch({ deviceId: DEVICE_ID, patch, label });
    });
    return result;
}

describe('Fermenter whole-patch auditioning through Command', () => {
    let notices: NotifyPayload[];
    let initialPatch: FermenterPatch;
    let otherPatch: FermenterPatch;

    beforeEach(async () => {
        notices = [];
        const bus = createEventBus<{
            'ui.notify': NotifyPayload;
            'ui.confirm': ConfirmPayload;
            'ui.prompt': PromptPayload;
        }>();
        bus.on('ui.notify', (notice) => {
            notices.push(notice);
        });
        setNotificationEventBus(bus);
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: leaveSession });
        await activateProject();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Fermenter patch audition integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getFermenterHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        actionHistoryStore.set({ entries: [] });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        projectStore.set({ ...defaultProjectStoreState, createdAt: 100, updatedAt: 100, loading: false });
        initialPatch = patchNamed('Original', 600);
        otherPatch = patchNamed('Other instance', 2400);
        trackStore.set({
            tracks: [
                {
                    ...createTrack({ id: TRACK_ID, name: 'Fermenter', kind: 'midi' }),
                    devices: [
                        {
                            id: DEVICE_ID,
                            type: 'fermenter',
                            name: 'Fermenter',
                            bypassed: false,
                            parameterValues: { filterCutoff: 600 },
                            deviceState: toFermenterDeviceState(initialPatch),
                        },
                        {
                            id: OTHER_DEVICE_ID,
                            type: 'fermenter',
                            name: 'Fermenter',
                            bypassed: false,
                            parameterValues: { filterCutoff: 2400 },
                            deviceState: toFermenterDeviceState(otherPatch),
                        },
                    ],
                },
            ],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        fermenterStore.set({});
        setFermenterDependencies({
            clampDeviceParameterValue,
            persistDeviceParam,
            persistDevicePatch,
            updateDeviceParam: audio.updateDeviceParam,
            updateDevicePatch: audio.updateDevicePatch,
            resolveEligibleDeviceWriteTarget,
            getAllTracks: () => trackStore.value?.tracks ?? [],
        });
        transportStore.set({ ...defaultTransportState, isPlaying: true, playheadPosition: 17 });
        flushAutomergeStorageWrites();
        audio.updateDeviceParam.mockClear();
        audio.updateDevicePatch.mockClear();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        agentProjectRepairStateStore.set(null);
        registerCrdtStorageRuntime();
        flushAutomergeStorageWrites();
        clearHandlerRegistry();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
    });

    async function modifiedAudition(): Promise<FermenterPatch> {
        renderPanel();
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(initialPatch));
        fireEvent.click(screen.getByRole('button', { name: 'Superloaf', exact: true }));
        await waitFor(() => expect(depth()).toBe(1));
        const previousMacro = getFermenterState(DEVICE_ID).patch.macros[0];
        const callbacks: FrameRequestCallback[] = [];
        const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
            callbacks.push(callback);
            return callbacks.length;
        });
        fireEvent.keyDown(screen.getByRole('slider', { name: 'Brightness', exact: true }), { key: 'ArrowUp' });
        const edited = cloneFermenterPatch(getFermenterState(DEVICE_ID).patch);
        expect(edited.macros[0]).not.toBe(previousMacro);
        act(() => callbacks[0]!(0));
        await waitFor(() => expect(committedPatch()).toEqual(edited));
        raf.mockRestore();
        expect(screen.getByText('Modified')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Show patch A' })).toBeEnabled();
        return edited;
    }

    it('restores project truth, panel state, runtime, and every nested patch field on undo and redo', async () => {
        const after = patchNamed('Auditioned', 1800);
        const transportBefore = transportStore.value;
        expect(await commit(after)).toBe(true);

        await waitFor(() => {
            expect(committedPatch()).toEqual(after);
            expect(getFermenterState(DEVICE_ID).patch).toEqual(after);
            expect(depth()).toBe(1);
        });
        expect(rawDevice().parameterValues.filterCutoff).toBe(1800);
        expect(audio.updateDevicePatch).toHaveBeenLastCalledWith(
            TRACK_ID,
            DEVICE_ID,
            expect.objectContaining({ cutoff: 1800 })
        );

        await act(() => undo());
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(initialPatch));
        expect(committedPatch()).toEqual(initialPatch);
        expect(rawDevice().parameterValues.filterCutoff).toBe(600);
        expect(depth()).toBe(0);
        expect(audio.updateDevicePatch).toHaveBeenLastCalledWith(
            TRACK_ID,
            DEVICE_ID,
            expect.objectContaining({ cutoff: 600 })
        );

        await act(() => redo());
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(after));
        expect(committedPatch()).toEqual(after);
        expect(depth()).toBe(1);
        expect(transportStore.value).toEqual(transportBefore);
        expect(committedPatch(OTHER_DEVICE_ID)).toEqual(otherPatch);
    });

    it('suppresses identical whole-patch loads without touching runtime or history', async () => {
        expect(await commit(cloneFermenterPatch(initialPatch))).toBe(true);

        expect(depth()).toBe(0);
        expect(audio.updateDevicePatch).not.toHaveBeenCalled();
        expect(committedPatch()).toEqual(initialPatch);
    });

    it('hydrates Blank Dough preset context before stepping to Superloaf in Synth', async () => {
        const firstPatch = resolveFermenterPresetPatch('fermenter-init', []);
        const secondPatch = resolveFermenterPresetPatch('fermenter-supersaw', []);
        if (!firstPatch || !secondPatch) {
            throw new Error('Expected both factory patches');
        }
        expect(await commit(firstPatch)).toBe(true);
        fermenterStore.set({});
        renderPanel();
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(firstPatch));
        fireEvent.click(screen.getByRole('button', { name: 'Synth', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Next preset' }));
        await waitFor(() => expect(committedPatch()).toEqual(secondPatch));
        expect(getFermenterState(DEVICE_ID).patch).toEqual(secondPatch);
        expect(depth()).toBe(2);
    });

    it('keeps independent A/B edits on both sides and reports Modified only against the active reference', async () => {
        renderPanel();
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(initialPatch));
        const preset = FERMENTER_PRESETS.find((candidate) => candidate.id !== 'fermenter-init');
        if (!preset) {
            throw new Error('Expected a non-init Fermenter preset');
        }

        fireEvent.click(screen.getByRole('button', { name: preset.name.replace('Fermenter — ', '') }));
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch.name).toBe(preset.name));
        expect(depth()).toBe(1);
        expect(screen.queryByText('Modified')).toBeNull();

        const editedB = cloneFermenterPatch(getFermenterState(DEVICE_ID).patch);
        editedB.name = 'Edited B';
        editedB.macros[2] = 0.91;
        editedB.macroMappings![4]!.targets[0]!.center = 0.63;
        act(() => loadFermenterPatch(DEVICE_ID, editedB));
        expect(screen.getByText('Modified')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Show patch A' }));
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(initialPatch));
        expect(screen.queryByText('Modified')).toBeNull();

        const editedA = cloneFermenterPatch(initialPatch);
        editedA.name = 'Edited A';
        editedA.macroMappings![0]!.targets[0]!.center = 4321;
        act(() => loadFermenterPatch(DEVICE_ID, editedA));

        fireEvent.click(screen.getByRole('button', { name: 'Show patch B' }));
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(editedB));
        expect(getFermenterState(DEVICE_ID).patch.macroMappings?.[4]?.targets[0]?.center).toBe(0.63);
        expect(screen.getByText('Modified')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Show patch A' }));
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(editedA));
        expect(screen.getByText('Modified')).toBeInTheDocument();
        expect(depth()).toBe(4);
    });

    it('keeps A/B references and Modified through a real continuous patch commit, then clears them on Undo', async () => {
        const edited = await modifiedAudition();
        expect(depth()).toBe(1);
        fireEvent.click(screen.getByRole('button', { name: 'Show patch A' }));
        await waitFor(() => expect(committedPatch()).toEqual(initialPatch));
        fireEvent.click(screen.getByRole('button', { name: 'Show patch B' }));
        await waitFor(() => expect(committedPatch()).toEqual(edited));
        expect(screen.getByText('Modified')).toBeInTheDocument();
        await act(() => undo());
        await waitFor(() => expect(committedPatch()).toEqual(initialPatch));
        expect(screen.getByRole('button', { name: 'Show patch A' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Show patch B' })).toBeDisabled();
        expect(screen.queryByText('Modified')).toBeNull();
    });

    it('clears A/B and Modified when a foreign project patch replaces a local continuous echo', async () => {
        await modifiedAudition();
        const foreign = patchNamed('Foreign project patch', 1200);
        expect(await commit(foreign)).toBe(true);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Show patch A' })).toBeDisabled());
        expect(screen.getByRole('button', { name: 'Show patch B' })).toBeDisabled();
        expect(screen.queryByText('Modified')).toBeNull();
        expect(committedPatch()).toEqual(foreign);
    });

    it('does not carry a local echo or A/B session into an equal-value successor project with reused IDs', async () => {
        const edited = await modifiedAudition();
        const successor = structuredClone(projectedTrack());
        await act(() => activateProject());
        act(() => {
            resetCrdtProjectAuthority('Equal-value successor');
            removeCrdtDoc('root');
            createCrdtDoc('root');
            registerCrdtStorageRuntime();
            replaceTrack(successor);
            flushAutomergeStorageWrites();
        });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Show patch A' })).toBeDisabled());
        expect(screen.getByRole('button', { name: 'Show patch B' })).toBeDisabled();
        expect(screen.queryByText('Modified')).toBeNull();
        expect(committedPatch()).toEqual(edited);
    });

    it('does not mistake an equal-value replacement device for its previous local echo', async () => {
        const edited = await modifiedAudition();
        const owner = structuredClone(projectedTrack());
        act(() => {
            replaceTrack({ ...owner, devices: owner.devices.filter((device) => device.id !== DEVICE_ID) });
            flushAutomergeStorageWrites();
            replaceTrack(owner);
            flushAutomergeStorageWrites();
        });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Show patch A' })).toBeDisabled());
        expect(screen.getByRole('button', { name: 'Show patch B' })).toBeDisabled();
        expect(screen.queryByText('Modified')).toBeNull();
        expect(committedPatch()).toEqual(edited);
    });

    it('makes Reset and Randomize one undo step each', async () => {
        renderPanel();
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(initialPatch));

        fireEvent.click(screen.getByRole('button', { name: 'Reset patch to default' }));
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(DEFAULT_PATCH));
        expect(depth()).toBe(1);

        fireEvent.click(screen.getByRole('button', { name: 'Randomize patch' }));
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch.name).toBe('Random'));
        expect(depth()).toBe(2);

        await act(() => undo());
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(DEFAULT_PATCH));
        await act(() => undo());
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(initialPatch));
        expect(depth()).toBe(0);
    });

    it('refuses a frozen target without mutating project, panel, runtime, or history', async () => {
        replaceTrack({ ...projectedTrack(), frozen: true });
        flushAutomergeStorageWrites();
        const before = committedPatch();

        expect(await commit(patchNamed('Frozen refusal', 900))).toBe(false);

        expect(committedPatch()).toEqual(before);
        expect(getFermenterState(DEVICE_ID).patch).toEqual(DEFAULT_PATCH);
        expect(depth()).toBe(0);
        expect(audio.updateDevicePatch).not.toHaveBeenCalled();
        expect(notices).toContainEqual({
            level: 'warning',
            message: 'Unfreeze the track before changing its Fermenter patch.',
        });
    });

    it('clears a modified-slot audition when undo restores another project patch', async () => {
        renderPanel();
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(initialPatch));
        const preset = FERMENTER_PRESETS.find((candidate) => candidate.id !== 'fermenter-init');
        if (!preset) {
            throw new Error('Expected a non-init Fermenter preset');
        }
        fireEvent.click(screen.getByRole('button', { name: preset.name.replace('Fermenter — ', '') }));
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch.name).toBe(preset.name));

        const editedB = cloneFermenterPatch(getFermenterState(DEVICE_ID).patch);
        editedB.name = 'Edited B';
        act(() => loadFermenterPatch(DEVICE_ID, editedB));
        fireEvent.click(screen.getByRole('button', { name: 'Show patch A' }));
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(initialPatch));
        fireEvent.click(screen.getByRole('button', { name: 'Show patch B' }));
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(editedB));

        await act(() => undo());
        await waitFor(() => expect(getFermenterState(DEVICE_ID).patch).toEqual(initialPatch));

        expect(screen.getByRole('button', { name: 'Show patch A' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Show patch B' })).toBeDisabled();
        expect(screen.queryByText('Modified')).toBeNull();
    });

    it.each([
        { label: 'macro', apply: loadFermenterPatchWithAudio },
        { label: 'morph', apply: applyMorphedPatch },
    ])('persists $label arrays in raw truth and fresh hydration after a whole patch', async ({ apply }) => {
        const whole = patchNamed('Whole', 1800);
        expect(await commit(whole)).toBe(true);
        const callbacks: FrameRequestCallback[] = [];
        const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
            callbacks.push(callback);
            return callbacks.length;
        });
        const edited = cloneFermenterPatch(whole);
        edited.macros[0] = 0.8;
        edited.macroMappings![0]!.targets[0]!.center = 0.42;
        act(() => apply(DEVICE_ID, edited));
        expect(callbacks).toHaveLength(1);
        act(() => callbacks[0]!(0));
        await waitFor(() => expect(committedPatch().macros[0]).toBe(0.8));
        flushAutomergeStorageWrites();
        const raw = committedPatch();
        fermenterStore.set({});
        const hydrated = hydrateFermenterFromProject(DEVICE_ID);
        raf.mockRestore();
        expect({
            rawMacro: raw.macros[0],
            rawCenter: raw.macroMappings![0]!.targets[0]!.center,
            hydratedMacro: hydrated!.macros[0],
            hydratedCenter: hydrated!.macroMappings![0]!.targets[0]!.center,
        }).toEqual({ rawMacro: 0.8, rawCenter: 0.42, hydratedMacro: 0.8, hydratedCenter: 0.42 });
    });

    it('redo preserves a whole patch after a pending macro patch', async () => {
        const callbacks = new Map<number, FrameRequestCallback>();
        let nextId = 0;
        const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
            callbacks.set(++nextId, callback);
            return nextId;
        });
        const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
            callbacks.delete(id);
        });
        const m = cloneFermenterPatch(initialPatch);
        m.macros[0] = 0.8;
        act(() => loadFermenterPatchWithAudio(DEVICE_ID, m));
        const n = patchNamed('Next', 1800);
        expect(await commit(n)).toBe(true);
        await act(() => undo());
        expect(committedPatch()).toEqual(m);
        await act(() => redo());
        raf.mockRestore();
        cancel.mockRestore();
        expect(committedPatch()).toEqual(n);
    });

    it('reconciles a pending parameter edit when a queued patch is refused by a revision change', async () => {
        const callbacks = new Map<number, FrameRequestCallback>();
        let nextId = 0;
        const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
            callbacks.set(++nextId, callback);
            return nextId;
        });
        const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
            callbacks.delete(id);
        });
        act(() => setFermenterParamWithAudio(DEVICE_ID, 'filterCutoff', 1200));
        const hold = await holdSnapshot();
        let pending!: Promise<boolean>;
        act(() => {
            pending = commitFermenterPatch({ deviceId: DEVICE_ID, patch: patchNamed('Next', 1800), label: 'Audition' });
        });
        hold.change(() => replaceTrack({ ...projectedTrack(), name: 'Concurrent edit' }));
        await act(async () => {
            await hold.finish();
        });
        expect(await pending).toBe(false);
        act(() => {
            for (const callback of callbacks.values()) {
                callback(0);
            }
        });
        flushAutomergeStorageWrites();
        const observed = {
            panel: getFermenterState(DEVICE_ID).patch.filterCutoff,
            project: rawDevice().parameterValues.filterCutoff,
            runtime: audio.updateDevicePatch.mock.calls.at(-1)?.[2]?.cutoff,
        };
        raf.mockRestore();
        cancel.mockRestore();
        expect(observed).toEqual({ panel: 600, project: 600, runtime: 600 });
    });

    it.each(['project', 'device'] as const)(
        'rejects a queued continuous frame after %s replacement without touching successor runtime',
        async (replacement) => {
            const callbacks: FrameRequestCallback[] = [];
            const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
                callbacks.push(callback);
                return callbacks.length;
            });
            const hold = await holdSnapshot();
            act(() => loadFermenterPatchWithAudio(DEVICE_ID, patchNamed('Stale draft', 1200)));
            act(() => callbacks[0]!(0));
            if (replacement === 'project') {
                await activateProject();
            }
            const successor = patchNamed('Successor', 3300);
            hold.change(() =>
                replaceTrack({
                    ...projectedTrack(),
                    devices: projectedTrack().devices.map((device) =>
                        device.id === DEVICE_ID
                            ? {
                                  ...device,
                                  deviceState: toFermenterDeviceState(successor),
                                  parameterValues: { filterCutoff: 3300 },
                              }
                            : device
                    ),
                })
            );
            await act(async () => {
                await hold.finish();
            });
            raf.mockRestore();
            await waitFor(() => expect(committedPatch()).toEqual(successor));
            expect(audio.updateDevicePatch).not.toHaveBeenCalled();
            expect(depth()).toBe(0);
            expect(hydrateFermenterFromProject(DEVICE_ID)).toEqual(successor);
        }
    );

    it('refuses a queued action after a non-target project revision', async () => {
        const hold = await holdSnapshot();
        let pending!: Promise<boolean>;
        act(() => {
            pending = commitFermenterPatch({ deviceId: DEVICE_ID, patch: patchNamed('Stale', 700), label: 'Audition' });
        });
        hold.change(() => {
            replaceTrack({ ...projectedTrack(), name: 'Renamed while the patch action was queued' });
        });
        await act(async () => {
            await hold.finish();
        });
        expect(await pending).toBe(false);

        expect(projectedTrack().name).toBe('Renamed while the patch action was queued');
        expect(rawDevice().type).toBe('fermenter');
        expect(committedPatch()).toEqual(initialPatch);
        expect(depth()).toBe(0);
        expect(audio.updateDevicePatch).not.toHaveBeenCalled();
    });
});
