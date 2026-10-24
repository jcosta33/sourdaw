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

import { ENGINE_NAMES } from '../../../models/FermenterPatch';
import { fermenterStore, getFermenterState, loadFermenterPatch } from '../../../stores/fermenterStore';
import { applyFermenterRuntimeParam } from '../../../useCases/applyFermenterRuntimeParam';
import { setFermenterDependencies } from '../../../useCases/fermenterDependencies';
import { selectFermenterOscillatorEngine } from '../../../useCases/selectFermenterOscillatorEngine';
import { FermenterPanel } from '../FermenterPanel';

const audio = vi.hoisted(() => ({ updateDeviceParam: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: audio.updateDeviceParam,
}));

const DEVICE_ID = 'fermenter-engine';
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

async function expectEngine(engine: number, historyDepth: number): Promise<void> {
    await waitFor(() => {
        expect(projectedTrack().devices[0]?.parameterValues.oscEngine ?? 0).toBe(engine);
        expect(rawValues().oscEngine ?? 0).toBe(engine);
        expect(getFermenterState(DEVICE_ID).patch.oscEngine).toBe(engine);
        expect(screen.getByRole('button', { name: ENGINE_NAMES[engine] })).toHaveAttribute('aria-pressed', 'true');
        expect(depth()).toBe(historyDepth);
    });
}

async function choose(engine: number, historyDepth: number): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: ENGINE_NAMES[engine] }));
    await expectEngine(engine, historyDepth);
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

describe('Fermenter Engine selection through Command', () => {
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
        resetCrdtProjectAuthority('Fermenter Engine integration');
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
                            parameterValues: { oscEngine: 0, filterCutoff: 600 },
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

    it('commits a real Engine chip selection as one undoable project edit', async () => {
        renderPanel();
        expect(screen.getByRole('button', { name: 'Wavetable' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'FM' }));
        await waitFor(() => expect(rawValues().oscEngine).toBe(2));
        expect(projectedTrack().devices[0]?.parameterValues.oscEngine).toBe(2);
        expect(getFermenterState(DEVICE_ID).patch.oscEngine).toBe(2);
        expect(depth()).toBe(1);
        await waitFor(() =>
            expect(getCrdtDoc<{ actionHistory: { entries: unknown[] } }>('root')?.actionHistory.entries).toHaveLength(1)
        );
        expect(notices).toEqual([]);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'oscEngine', 2);
        await act(() => undo());
        await expectEngine(0, 0);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'oscEngine', 0);
        await act(() => redo());
        await expectEngine(2, 1);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'oscEngine', 2);
    });

    it('restores raw absence and Wavetable when Undo deletes the first Engine selection', async () => {
        replaceValues({ filterCutoff: 600 });
        flushAutomergeStorageWrites();
        renderPanel();
        const patch = getFermenterState(DEVICE_ID).patch;
        const macros = [...patch.macros];
        macros[0] = 0.84;
        act(() => loadFermenterPatch(DEVICE_ID, { ...patch, macros }));
        await choose(2, 1);
        await act(() => undo());
        await expectEngine(0, 0);
        expect(Object.hasOwn(rawValues(), 'oscEngine')).toBe(false);
        expect(Object.hasOwn(projectedTrack().devices[0]!.parameterValues, 'oscEngine')).toBe(false);
        expect(rawValues().filterCutoff).toBe(600);
        expect(getFermenterState(DEVICE_ID).patch.macros[0]).toBe(0.84);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'oscEngine', 0);
        await act(() => redo());
        await expectEngine(2, 1);
        expect(rawValues().filterCutoff).toBe(600);
        expect(getFermenterState(DEVICE_ID).patch.macros[0]).toBe(0.84);
    });

    it('keeps two settled Engine selections as separate Undo entries', async () => {
        renderPanel();
        await choose(2, 1);
        await choose(3, 2);
        await act(() => undo());
        await expectEngine(2, 1);
        await act(() => undo());
        await expectEngine(0, 0);
    });

    it.each([true, false])('ignores the effective current Engine with a present leaf: %s', async (present) => {
        replaceValues(present ? { oscEngine: 0, filterCutoff: 600 } : { filterCutoff: 600 });
        flushAutomergeStorageWrites();
        renderPanel();
        await act(() => selectFermenterOscillatorEngine(DEVICE_ID, 0));
        await expectEngine(0, 0);
        expect(Object.hasOwn(rawValues(), 'oscEngine')).toBe(present);
        expect(audio.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('retains an already-frozen owner’s existing Engine edit policy', async () => {
        replaceTrack({ ...projectedTrack(), frozen: true });
        flushAutomergeStorageWrites();
        renderPanel();
        await choose(2, 1);
        expect(projectedTrack().frozen).toBe(true);
        await act(() => undo());
        await expectEngine(0, 0);
    });

    it('reports refused mutation admission without changing the selected Engine', async () => {
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
        fireEvent.click(screen.getByRole('button', { name: 'FM' }));
        await waitFor(() =>
            expect(notices).toContainEqual({
                level: 'warning',
                message: 'Project repair is required before project actions can execute',
            })
        );
        await expectEngine(0, 0);
        expect(audio.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('refuses an Engine selection when project authority changes without a document edit', async () => {
        renderPanel();
        const hold = await holdSnapshot();
        const revision = captureProjectRevision();
        const pending = selectFermenterOscillatorEngine(DEVICE_ID, 2);
        await activateProject();
        expect(captureProjectRevision()).toBe(revision);
        await act(async () => {
            await hold.finish();
            await pending;
        });
        await expectEngine(0, 0);
        expect(audio.updateDeviceParam).not.toHaveBeenCalled();
        await choose(1, 1);
    });

    it('publishes no preview while waiting and commits once an unchanged snapshot releases', async () => {
        renderPanel();
        const hold = await holdSnapshot();
        const pending = selectFermenterOscillatorEngine(DEVICE_ID, 2);
        await expectEngine(0, 0);
        expect(audio.updateDeviceParam).not.toHaveBeenCalled();
        await act(async () => {
            await hold.finish();
            await pending;
        });
        await expectEngine(2, 1);
        expect(audio.updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'oscEngine', 2);
    });

    it.each(['project', 'same-id-owner', 'same-id-device', 'chain', 'value', 'frozen', 'exact-state-aba'] as const)(
        'refuses a snapshot-held selection after %s replacement',
        async (change) => {
            renderPanel();
            const hold = await holdSnapshot();
            const pending = selectFermenterOscillatorEngine(DEVICE_ID, 2);
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
                        replaceValues({ ...rawValues(), oscEngine: 4 });
                    } else if (change === 'frozen') {
                        replaceTrack({ ...track, frozen: true });
                    } else {
                        replaceValues({ ...rawValues(), oscEngine: 4 });
                    }
                });
                if (change === 'exact-state-aba') {
                    hold.change(() => replaceTrack(track));
                }
                await hold.finish();
                await pending;
            });
            await expectEngine(change === 'value' ? 4 : 0, 0);
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
            let failure = new Error('Engine selection commit refused');
            if (mode === 'write-conflict') {
                failure = new AutomergeStorageWriteConflictError('Engine selection storage conflict');
            }
            configureAutomergeStoragePort({
                getDoc: (id) => getCrdtDoc<Record<string, unknown>>(id),
                hasDoc: hasCrdtDoc,
                getSemanticMessage: () => undefined,
                mutateDoc: () => {
                    throw failure;
                },
            });
            await act(() => selectFermenterOscillatorEngine(DEVICE_ID, 2));
            registerCrdtStorageRuntime();
            await expectEngine(0, 0);
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

    it('keeps runtime automation outside manual Engine history and project truth', async () => {
        renderPanel();
        await choose(2, 1);
        act(() => applyFermenterRuntimeParam({ deviceId: DEVICE_ID, paramId: 'oscEngine', value: 4 }));
        await expectEngine(2, 1);
        expect(audio.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, 'engine', 4);
    });

    it.each(['missing', 'wrong-type', 'duplicate-owner', 'invalid-engine'] as const)(
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
            await selectFermenterOscillatorEngine(
                invalid === 'missing' ? 'missing' : DEVICE_ID,
                invalid === 'invalid-engine' ? 7 : 2
            );
            expect(captureProjectRevision()).toBe(revision);
            expect(depth()).toBe(0);
            expect(audio.updateDeviceParam).not.toHaveBeenCalled();
        }
    );
});
