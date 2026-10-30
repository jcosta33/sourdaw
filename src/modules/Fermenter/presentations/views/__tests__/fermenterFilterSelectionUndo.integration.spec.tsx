import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    AutomergeStorageWriteConflictError,
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
import { clampDeviceParameterValue, createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
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
    captureProjectRevision,
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    hasCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { FILTER_MODEL_NAMES, FILTER_MODE_NAMES } from '../../../models/FermenterPatch';
import { fermenterStore, getFermenterState, loadFermenterPatch } from '../../../stores/fermenterStore';
import { applyFermenterRuntimeParam } from '../../../useCases/applyFermenterRuntimeParam';
import { setFermenterDependencies } from '../../../useCases/fermenterDependencies';
import { setFermenterParamWithAudio } from '../../../useCases/fermenterParamBridge/setFermenterParamWithAudio';
import { selectFermenterFilterChoice } from '../../../useCases/selectFermenterFilterChoice';
import { FermenterPanel } from '../FermenterPanel';

const audio = vi.hoisted(() => ({ updateDeviceParam: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: audio.updateDeviceParam,
}));

const DEVICE_ID = 'fermenter-filter';
const TRACK_ID = 'fermenter-track';

function projectedTrack(): Track {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID);
    if (!track) {
        throw new Error('Expected the Fermenter track projection');
    }
    return track;
}

function rawValues(): Record<string, number> {
    const document = getCrdtDoc<{ tracks: { tracks: Track[] } }>('root');
    const device = document?.tracks.tracks.find((track) => track.id === TRACK_ID)?.devices[0];
    if (!device) {
        throw new Error('Expected the committed Fermenter device');
    }
    return device.parameterValues;
}

function depth(): number {
    return undoStore.value?.past.length ?? 0;
}

function renderPanel(): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <FermenterPanel deviceId={DEVICE_ID} />
        </QueryClientProvider>
    );
    fireEvent.click(screen.getAllByRole('button', { name: /^Filter$/ })[0]!);
}

function replaceTrack(track: Track): void {
    trackStore.set({ tracks: [track], selectedTrackId: TRACK_ID, ghostClips: [] });
}

function replaceValues(values: Record<string, number>): void {
    const track = projectedTrack();
    replaceTrack({ ...track, devices: track.devices.map((device) => ({ ...device, parameterValues: values })) });
}

async function activateProject(): Promise<void> {
    const transition = runProjectLoadTransaction();
    expect(await transition.prepare()).toBe(true);
    expect(transition.activate()).toBe(true);
}

async function expectModel(model: number, historyDepth: number): Promise<void> {
    await waitFor(() => {
        expect(projectedTrack().devices[0]?.parameterValues.filterModel ?? 0).toBe(model);
        expect(rawValues().filterModel ?? 0).toBe(model);
        expect(getFermenterState(DEVICE_ID).patch.filterModel).toBe(model);
        expect(screen.getByRole('button', { name: FILTER_MODEL_NAMES[model] })).toHaveAttribute('aria-pressed', 'true');
        expect(depth()).toBe(historyDepth);
    });
}

async function expectType(mode: number, historyDepth: number): Promise<void> {
    await waitFor(() => {
        expect(projectedTrack().devices[0]?.parameterValues.filterMode ?? 0).toBe(mode);
        expect(rawValues().filterMode ?? 0).toBe(mode);
        expect(getFermenterState(DEVICE_ID).patch.filterMode).toBe(mode);
        expect(screen.getByRole('button', { name: FILTER_MODE_NAMES[mode] })).toHaveAttribute('aria-pressed', 'true');
        expect(depth()).toBe(historyDepth);
    });
}

async function chooseModel(model: number, historyDepth: number): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: FILTER_MODEL_NAMES[model] }));
    await expectModel(model, historyDepth);
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

describe('Fermenter Filter selection through Command', () => {
    let notices: NotifyPayload[];

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
        resetCrdtProjectAuthority('Fermenter Filter integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
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
                            parameterValues: { oscEngine: 2, filterModel: 0, filterMode: 0, filterCutoff: 600 },
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
            updateDeviceParam: audio.updateDeviceParam,
            resolveEligibleDeviceWriteTarget,
            getAllTracks: () => trackStore.value?.tracks ?? [],
        });
        flushAutomergeStorageWrites();
        audio.updateDeviceParam.mockClear();
    });

    afterEach(() => {
        cleanup();
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

    it('commits a real Model chip selection as one undoable project edit', async () => {
        renderPanel();
        expect(screen.getByRole('button', { name: FILTER_MODEL_NAMES[0] })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: FILTER_MODEL_NAMES[2] }));
        await waitFor(() => expect(rawValues().filterModel).toBe(2));
        expect(projectedTrack().devices[0]?.parameterValues.filterModel).toBe(2);
        expect(getFermenterState(DEVICE_ID).patch.filterModel).toBe(2);
        expect(depth()).toBe(1);
        await waitFor(() =>
            expect(getCrdtDoc<{ actionHistory: { entries: unknown[] } }>('root')?.actionHistory.entries).toHaveLength(1)
        );
        expect(notices).toEqual([]);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'filterModel', 2);
        await act(() => undo());
        await expectModel(0, 0);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'filterModel', 0);
        await act(() => redo());
        await expectModel(2, 1);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'filterModel', 2);
    });

    it('restores raw absence and SVF when Undo deletes the first Model selection', async () => {
        replaceValues({ filterCutoff: 600 });
        flushAutomergeStorageWrites();
        renderPanel();
        const patch = getFermenterState(DEVICE_ID).patch;
        const macros: typeof patch.macros = [...patch.macros];
        macros[0] = 0.84;
        act(() => loadFermenterPatch(DEVICE_ID, { ...patch, macros }));
        await chooseModel(2, 1);
        await act(() => undo());
        await expectModel(0, 0);
        expect(Object.hasOwn(rawValues(), 'filterModel')).toBe(false);
        expect(Object.hasOwn(projectedTrack().devices[0]!.parameterValues, 'filterModel')).toBe(false);
        expect(rawValues().filterCutoff).toBe(600);
        expect(getFermenterState(DEVICE_ID).patch.macros[0]).toBe(0.84);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'filterModel', 0);
        await act(() => redo());
        await expectModel(2, 1);
        expect(rawValues().filterCutoff).toBe(600);
        expect(getFermenterState(DEVICE_ID).patch.macros[0]).toBe(0.84);
    });

    it('keeps two settled Model selections as separate Undo entries', async () => {
        renderPanel();
        await chooseModel(2, 1);
        await chooseModel(3, 2);
        await act(() => undo());
        await expectModel(2, 1);
        await act(() => undo());
        await expectModel(0, 0);
    });

    it.each([true, false])('ignores the effective current Model with a present leaf: %s', async (present) => {
        replaceValues(present ? { filterModel: 0, filterCutoff: 600 } : { filterCutoff: 600 });
        flushAutomergeStorageWrites();
        renderPanel();
        await act(() => selectFermenterFilterChoice(DEVICE_ID, 'filterModel', 0));
        await expectModel(0, 0);
        expect(Object.hasOwn(rawValues(), 'filterModel')).toBe(present);
        expect(audio.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('retains an already-frozen owner’s existing Model edit policy', async () => {
        replaceTrack({ ...projectedTrack(), frozen: true });
        flushAutomergeStorageWrites();
        renderPanel();
        await chooseModel(2, 1);
        expect(projectedTrack().frozen).toBe(true);
        await act(() => undo());
        await expectModel(0, 0);
    });

    it('reports refused mutation admission without changing the selected Model', async () => {
        renderPanel();
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: captureProjectRevision(),
            inspectionAvailable: true,
            projectInvariantsValid: true,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });
        fireEvent.click(screen.getByRole('button', { name: FILTER_MODEL_NAMES[2] }));
        await waitFor(() =>
            expect(notices).toContainEqual({
                level: 'warning',
                message: 'Project repair is required before project actions can execute',
            })
        );
        await expectModel(0, 0);
        expect(audio.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('refuses a Model selection when project authority changes without a document edit', async () => {
        renderPanel();
        const hold = await holdSnapshot();
        const revision = captureProjectRevision();
        const pending = selectFermenterFilterChoice(DEVICE_ID, 'filterModel', 2);
        await activateProject();
        expect(captureProjectRevision()).toBe(revision);
        await act(async () => {
            await hold.finish();
            await pending;
        });
        await expectModel(0, 0);
        expect(audio.updateDeviceParam).not.toHaveBeenCalled();
        await chooseModel(1, 1);
    });

    it('publishes no preview while waiting and commits once an unchanged snapshot releases', async () => {
        renderPanel();
        const hold = await holdSnapshot();
        const pending = selectFermenterFilterChoice(DEVICE_ID, 'filterModel', 2);
        await expectModel(0, 0);
        expect(audio.updateDeviceParam).not.toHaveBeenCalled();
        await act(async () => {
            await hold.finish();
            await pending;
        });
        await expectModel(2, 1);
        expect(audio.updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'filterModel', 2);
    });

    it.each([0, 3])('settles on the latest queued Model choice %i while a snapshot is held', async (latest) => {
        renderPanel();
        const hold = await holdSnapshot();
        const first = selectFermenterFilterChoice(DEVICE_ID, 'filterModel', 2);
        const second = selectFermenterFilterChoice(DEVICE_ID, 'filterModel', latest);
        await expectModel(0, 0);
        expect(audio.updateDeviceParam).not.toHaveBeenCalled();
        await act(async () => {
            await hold.finish();
            await Promise.all([first, second]);
        });
        await waitFor(() => {
            expect(rawValues().filterModel).toBe(latest);
            expect(projectedTrack().devices[0]?.parameterValues.filterModel).toBe(latest);
            expect(getFermenterState(DEVICE_ID).patch.filterModel).toBe(latest);
            expect(screen.getByRole('button', { name: FILTER_MODEL_NAMES[latest] })).toHaveAttribute(
                'aria-pressed',
                'true'
            );
        });
        expect(audio.updateDeviceParam).toHaveBeenCalledTimes(latest === 0 ? 0 : 1);
        if (latest !== 0) {
            expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'filterModel', latest);
        }
        expect(depth()).toBe(latest === 0 ? 0 : 1);
        expect(actionHistoryStore.value?.entries).toHaveLength(latest === 0 ? 0 : 1);
        expect(notices).toEqual([]);
        if (latest !== 0) {
            await act(() => undo());
            await expectModel(0, 0);
        }
    });

    it('does not let an invalid later Model choice cancel a valid queued choice', async () => {
        renderPanel();
        const hold = await holdSnapshot();
        const pending = selectFermenterFilterChoice(DEVICE_ID, 'filterModel', 2);
        await selectFermenterFilterChoice(DEVICE_ID, 'filterModel', 7);
        await act(async () => {
            await hold.finish();
            await pending;
        });
        await expectModel(2, 1);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'filterModel', 2);
    });

    it.each(['project', 'same-id-owner', 'same-id-device', 'chain', 'value', 'frozen', 'exact-state-aba'] as const)(
        'refuses a snapshot-held selection after %s replacement',
        async (change) => {
            renderPanel();
            const hold = await holdSnapshot();
            const pending = selectFermenterFilterChoice(DEVICE_ID, 'filterModel', 2);
            const track = projectedTrack();
            await act(async () => {
                hold.change(() => {
                    if (change === 'project') {
                        resetCrdtProjectAuthority('Replacement project');
                        projectStore.set({
                            ...defaultProjectStoreState,
                            createdAt: 100,
                            updatedAt: 100,
                            loading: false,
                        });
                        replaceTrack({ ...track, name: 'Incoming project track' });
                    } else if (change === 'same-id-owner') {
                        replaceTrack({ ...track, name: 'New owner' });
                    } else if (change === 'same-id-device') {
                        replaceTrack({
                            ...track,
                            devices: track.devices.map((device) => ({ ...device, name: 'Replacement device' })),
                        });
                    } else if (change === 'chain') {
                        replaceTrack({
                            ...track,
                            devices: [...track.devices, { ...track.devices[0]!, id: 'second-device' }],
                        });
                    } else if (change === 'value') {
                        replaceValues({ ...rawValues(), filterModel: 4 });
                    } else if (change === 'frozen') {
                        replaceTrack({ ...track, frozen: true });
                    } else {
                        replaceValues({ ...rawValues(), filterModel: 4 });
                    }
                });
                if (change === 'exact-state-aba') {
                    hold.change(() => replaceTrack(track));
                }
                await hold.finish();
                await pending;
            });
            await expectModel(change === 'value' ? 4 : 0, 0);
            expect(audio.updateDeviceParam).not.toHaveBeenCalled();
            if (change === 'same-id-owner') {
                expect(projectedTrack().name).toBe('New owner');
            }
            if (change === 'same-id-device') {
                expect(projectedTrack().devices[0]?.name).toBe('Replacement device');
            }
            if (change === 'chain') {
                expect(projectedTrack().devices).toHaveLength(2);
            }
            if (change === 'frozen') {
                expect(projectedTrack().frozen).toBe(true);
            }
            if (change === 'project') {
                expect(projectedTrack().name).toBe('Incoming project track');
            }
        }
    );

    it.each(['commit-error', 'write-conflict'] as const)(
        'rolls back a real storage %s without false history',
        async (mode) => {
            renderPanel();
            let failure = new Error('Model selection commit refused');
            if (mode === 'write-conflict') {
                failure = new AutomergeStorageWriteConflictError('Model selection storage conflict');
            }
            configureAutomergeStoragePort({
                getDoc: (id) => getCrdtDoc<Record<string, unknown>>(id),
                hasDoc: hasCrdtDoc,
                getSemanticMessage: () => undefined,
                mutateDoc: () => {
                    throw failure;
                },
            });
            await act(() => selectFermenterFilterChoice(DEVICE_ID, 'filterModel', 2));
            registerCrdtStorageRuntime();
            await expectModel(0, 0);
            expect(getCrdtDoc<{ actionHistory: { entries: unknown[] } }>('root')?.actionHistory.entries).toHaveLength(
                0
            );
            expect(audio.updateDeviceParam.mock.calls.map((call) => call[3])).toEqual([2, 0]);
            expect(notices).toContainEqual(
                expect.objectContaining({
                    level: mode === 'write-conflict' ? 'warning' : 'error',
                    message: expect.any(String),
                })
            );
        }
    );

    it('keeps runtime automation outside manual Model history and project truth', async () => {
        renderPanel();
        await chooseModel(2, 1);
        act(() => applyFermenterRuntimeParam({ deviceId: DEVICE_ID, paramId: 'filterModel', value: 4 }));
        await expectModel(2, 1);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'filter_model', 4);
    });

    it.each(['missing', 'wrong-type', 'duplicate-owner', 'invalid-model'] as const)(
        'does not write for a %s target',
        async (invalid) => {
            if (invalid === 'wrong-type') {
                const track = projectedTrack();
                replaceTrack({ ...track, devices: track.devices.map((device) => ({ ...device, type: 'synth' })) });
            } else if (invalid === 'duplicate-owner') {
                const track = projectedTrack();
                trackStore.set({
                    tracks: [track, { ...track, id: 'other-track' }],
                    selectedTrackId: TRACK_ID,
                    ghostClips: [],
                });
            }
            flushAutomergeStorageWrites();
            const revision = captureProjectRevision();
            await selectFermenterFilterChoice(
                invalid === 'missing' ? 'missing' : DEVICE_ID,
                'filterModel',
                invalid === 'invalid-model' ? 7 : 2
            );
            expect(captureProjectRevision()).toBe(revision);
            expect(depth()).toBe(0);
            expect(audio.updateDeviceParam).not.toHaveBeenCalled();
        }
    );
    it('keeps Type and Model as two independent entries and retains the hidden Type', async () => {
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'High Pass' }));
        await expectType(1, 1);
        await chooseModel(1, 2);
        expect(rawValues().filterMode).toBe(1);
        expect(screen.queryByRole('button', { name: 'High Pass' })).not.toBeInTheDocument();
        await act(() => undo());
        await expectModel(0, 1);
        await expectType(1, 1);
        await act(() => undo());
        await expectType(0, 0);
        expect(rawValues().filterModel).toBe(0);
        await act(() => redo());
        await expectType(1, 1);
        await act(() => redo());
        await expectModel(1, 2);
        expect(rawValues().filterMode).toBe(1);
    });

    it.each(['filterModel', 'filterMode'] as const)(
        'restores raw absence for a first %s selection',
        async (paramId) => {
            const other = paramId === 'filterModel' ? 'filterMode' : 'filterModel';
            replaceValues({ oscEngine: 2, filterCutoff: 600, [other]: 0 });
            flushAutomergeStorageWrites();
            renderPanel();
            const patch = getFermenterState(DEVICE_ID).patch;
            const macros: typeof patch.macros = [...patch.macros];
            macros[0] = 0.84;
            act(() => loadFermenterPatch(DEVICE_ID, { ...patch, macros, filterDrive: 0.31 }));
            fireEvent.click(
                screen.getByRole('button', {
                    name: paramId === 'filterModel' ? FILTER_MODEL_NAMES[1] : FILTER_MODE_NAMES[1],
                })
            );
            await waitFor(() => expect(rawValues()[paramId]).toBe(1));
            expect(depth()).toBe(1);
            await act(() => undo());
            if (paramId === 'filterModel') {
                await expectModel(0, 0);
            } else {
                await expectType(0, 0);
            }
            expect(Object.hasOwn(rawValues(), paramId)).toBe(false);
            expect(Object.hasOwn(projectedTrack().devices[0]!.parameterValues, paramId)).toBe(false);
            expect(rawValues()[other]).toBe(0);
            expect(rawValues().oscEngine).toBe(2);
            expect(rawValues().filterCutoff).toBe(600);
            expect(getFermenterState(DEVICE_ID).patch.oscEngine).toBe(2);
            expect(getFermenterState(DEVICE_ID).patch.macros[0]).toBe(0.84);
            expect(getFermenterState(DEVICE_ID).patch.filterDrive).toBe(0.31);
            expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, paramId, 0);
            await act(() => redo());
            await waitFor(() => expect(rawValues()[paramId]).toBe(1));
            expect(Object.hasOwn(rawValues(), paramId)).toBe(true);
            expect(depth()).toBe(1);
        }
    );

    it.each(['filterModel', 'filterMode'] as const)(
        'keeps an explicit %s default present after Undo',
        async (paramId) => {
            renderPanel();
            await act(() => selectFermenterFilterChoice(DEVICE_ID, paramId, 1));
            await waitFor(() => expect(rawValues()[paramId]).toBe(1));
            await act(() => undo());
            await waitFor(() => expect(rawValues()[paramId]).toBe(0));
            expect(Object.hasOwn(rawValues(), paramId)).toBe(true);
            expect(depth()).toBe(0);
        }
    );

    it('admits both parameters queued behind one unchanged snapshot without superseding either', async () => {
        renderPanel();
        const hold = await holdSnapshot();
        const type = selectFermenterFilterChoice(DEVICE_ID, 'filterMode', 1);
        const model = selectFermenterFilterChoice(DEVICE_ID, 'filterModel', 1);
        expect(depth()).toBe(0);
        expect(audio.updateDeviceParam).not.toHaveBeenCalled();
        await act(async () => {
            await hold.finish();
            await Promise.all([type, model]);
        });
        await expectModel(1, 2);
        expect(rawValues().filterMode).toBe(1);
        expect(getFermenterState(DEVICE_ID).patch.filterMode).toBe(1);
        expect(audio.updateDeviceParam.mock.calls.map((call) => [call[2], call[3]])).toEqual([
            ['filterMode', 1],
            ['filterModel', 1],
        ]);
        await act(() => undo());
        await expectModel(0, 1);
        await expectType(1, 1);
        await act(() => undo());
        await expectType(0, 0);
    });

    it('cancels a queued legacy parameter frame before the manual choice takes authority', async () => {
        renderPanel();
        const frame: { callback?: FrameRequestCallback } = {};
        const request = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementationOnce((callback) => {
            frame.callback = callback;
            return 12345;
        });
        act(() => setFermenterParamWithAudio(DEVICE_ID, 'filterModel', 4));
        request.mockRestore();
        expect(frame.callback).toBeDefined();
        await chooseModel(1, 1);
        act(() => frame.callback!(0));
        flushAutomergeStorageWrites();
        await expectModel(1, 1);
        expect(audio.updateDeviceParam.mock.calls.map((call) => call[3])).toEqual([1]);
        await act(() => undo());
        await expectModel(0, 0);
    });

    it('keeps an ordinary panel control and runtime filter automation outside manual history', async () => {
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: /^Oscillator$/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Square' }));
        await waitFor(() => expect(rawValues().oscWaveform).toBe(2));
        expect(depth()).toBe(0);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'osc_waveform', 2);
        fireEvent.click(screen.getAllByRole('button', { name: /^Filter$/ })[0]!);
        await chooseModel(1, 1);
        act(() => applyFermenterRuntimeParam({ deviceId: DEVICE_ID, paramId: 'filterModel', value: 4 }));
        await expectModel(1, 1);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'filter_model', 4);
        act(() => applyFermenterRuntimeParam({ deviceId: DEVICE_ID, paramId: 'filterMode', value: 2 }));
        expect(rawValues().filterMode).toBe(0);
        expect(getFermenterState(DEVICE_ID).patch.filterMode).toBe(0);
        expect(depth()).toBe(1);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'filter_mode', 2);
    });

    it.each([
        ['filterModel', -1],
        ['filterModel', 6],
        ['filterModel', 1.5],
        ['filterMode', -1],
        ['filterMode', 4],
        ['filterMode', Number.NaN],
    ] as const)('rejects invalid %s choice %s before dispatch', async (paramId, value) => {
        const revision = captureProjectRevision();
        await selectFermenterFilterChoice(DEVICE_ID, paramId, value);
        expect(captureProjectRevision()).toBe(revision);
        expect(depth()).toBe(0);
        expect(audio.updateDeviceParam).not.toHaveBeenCalled();
    });

    it.each(['removed-device', 'duplicate-device', 'removed-root'] as const)(
        'rejects a queued choice after %s',
        async (change) => {
            renderPanel();
            const hold = await holdSnapshot();
            const pending = selectFermenterFilterChoice(DEVICE_ID, 'filterModel', 1);
            await act(async () => {
                hold.change(() => {
                    const track = projectedTrack();
                    if (change === 'removed-root') {
                        removeCrdtDoc('root');
                        createCrdtDoc('root');
                    } else if (change === 'removed-device') {
                        replaceTrack({ ...track, devices: [] });
                    } else {
                        replaceTrack({
                            ...track,
                            devices: [...track.devices, { ...track.devices[0]!, name: 'Duplicate occurrence' }],
                        });
                    }
                });
                await hold.finish();
                await pending;
            });
            expect(depth()).toBe(0);
            expect(audio.updateDeviceParam).not.toHaveBeenCalled();
            if (change !== 'removed-root') {
                expect(projectedTrack().devices).toHaveLength(change === 'removed-device' ? 0 : 2);
            }
        }
    );
    it('keeps two devices queued for the same parameter independent', async () => {
        const track = projectedTrack();
        const secondId = 'second-fermenter';
        replaceTrack({ ...track, devices: [...track.devices, { ...track.devices[0]!, id: secondId }] });
        flushAutomergeStorageWrites();
        renderPanel();
        const hold = await holdSnapshot();
        const first = selectFermenterFilterChoice(DEVICE_ID, 'filterModel', 1);
        const second = selectFermenterFilterChoice(secondId, 'filterModel', 3);
        await act(async () => {
            await hold.finish();
            await Promise.all([first, second]);
        });
        await expectModel(1, 2);
        expect(projectedTrack().devices[1]?.parameterValues.filterModel).toBe(3);
        expect(
            getCrdtDoc<{ tracks: { tracks: Track[] } }>('root')?.tracks.tracks[0]?.devices[1]?.parameterValues
                .filterModel
        ).toBe(3);
        expect(audio.updateDeviceParam.mock.calls.map((call) => [call[1], call[2], call[3]])).toEqual([
            [DEVICE_ID, 'filterModel', 1],
            [secondId, 'filterModel', 3],
        ]);
        await act(() => undo());
        await expectModel(1, 1);
        expect(projectedTrack().devices[1]?.parameterValues.filterModel).toBe(0);
        await act(() => undo());
        await expectModel(0, 0);
    });

    it.each(['undo', 'redo'] as const)('preserves a peer filter edit when %s is stale', async (leg) => {
        renderPanel();
        await chooseModel(1, 1);
        if (leg === 'redo') {
            await act(() => undo());
            await expectModel(0, 0);
        }
        act(() => replaceValues({ ...rawValues(), filterModel: 4 }));
        flushAutomergeStorageWrites();
        audio.updateDeviceParam.mockClear();
        await act(async () => {
            if (leg === 'undo') {
                await undo();
            } else {
                await redo();
            }
        });
        await expectModel(4, leg === 'undo' ? 1 : 0);
        expect(undoStore.value?.future).toHaveLength(leg === 'undo' ? 0 : 1);
        expect(audio.updateDeviceParam).not.toHaveBeenCalled();
        expect(notices).toContainEqual(expect.objectContaining({ level: 'warning' }));
    });
});
