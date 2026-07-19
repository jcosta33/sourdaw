import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { trackStore } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import {
    type ArrangementSnapshot,
    arrangementStore,
    defaultArrangementStoreState,
} from '../../stores/arrangementStore';
import { switchArrangement } from '../arrangement/switchArrangement';
import { runProjectLoadTransaction } from '../projectPersistence/helpers/runProjectLoadTransaction';
import { setProjectIdentityTransitionDependencies } from '../projectPersistence/projectIdentityTransitionDependencies';
import { markDirty } from '../projectPersistence/saveProject/markDirty';

const {
    cancelFreezeTasksForProjectTransition,
    cancelPendingAudioBufferImport,
    prepareCachedAudioBuffersFromIdb,
    publishPreparedBuffers,
    reconcileAdjustmentLayerStaleness,
} = vi.hoisted(() => ({
    cancelFreezeTasksForProjectTransition: vi.fn(() => Promise.resolve()),
    cancelPendingAudioBufferImport: vi.fn(),
    prepareCachedAudioBuffersFromIdb: vi.fn(),
    publishPreparedBuffers: vi.fn(() => 1),
    reconcileAdjustmentLayerStaleness: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    cancelFreezeTasksForProjectTransition,
    reconcileAdjustmentLayerStaleness,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cancelPendingAudioBufferImport,
    getAudioContext: vi.fn(() => ({})),
    prepareCachedAudioBuffersFromIdb,
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/useCases')>();
    return {
        ...actual,
        stopPlayback: vi.fn(),
    };
});
vi.mock('../projectPersistence/saveProject/markDirty', () => ({ markDirty: vi.fn() }));
type SnapshotTrack = ArrangementSnapshot['tracks']['tracks'][number];

function create_snapshot_track(overrides: Partial<SnapshotTrack> = {}): SnapshotTrack {
    return {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#fff',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
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
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
}

describe('switchArrangement', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
        clearHandlerRegistry();
        clearUndoHistory();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        arrangementStore.set(structuredClone(defaultArrangementStoreState));
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        prepareCachedAudioBuffersFromIdb.mockResolvedValue({ publish: publishPreparedBuffers });
        cancelFreezeTasksForProjectTransition.mockResolvedValue(undefined);
    });

    afterEach(() => {
        clearHandlerRegistry();
        clearUndoHistory();
    });

    it('does not call transport or persistence collaborators when switching to the active arrangement', async () => {
        const arrangementId = arrangementStore.value!.activeArrangementId;
        await switchArrangement(arrangementId);

        expect(stopPlayback).not.toHaveBeenCalled();
        expect(markDirty).not.toHaveBeenCalled();
    });

    it('waits behind an in-flight action and clears its history in the arrangement transition', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'target-behind-command';
        state.arrangements.push(target);
        arrangementStore.set(state);

        let releaseAction: (() => void) | undefined;
        let markActionStarted: (() => void) | undefined;
        const actionGate = new Promise<void>((resolve) => {
            releaseAction = resolve;
        });
        const actionStarted = new Promise<void>((resolve) => {
            markActionStarted = resolve;
        });
        registerHandlerMap({
            setEditingTool: {
                undoable: true,
                describe: () => ({
                    label: 'Gated project edit',
                    inverseAction: { type: 'setEditingTool', payload: { tool: 'select' } },
                }),
                execute: async () => {
                    markActionStarted?.();
                    await actionGate;
                },
            },
        });

        const actionExecution = executeAppAction({ type: 'setEditingTool', payload: { tool: 'draw' } });
        await actionStarted;
        const switching = switchArrangement(target.id);
        await vi.waitFor(() => expect(prepareCachedAudioBuffersFromIdb).toHaveBeenCalledOnce());

        const transitionWaitedForAction =
            vi.mocked(stopPlayback).mock.calls.length === 0 &&
            arrangementStore.value?.activeArrangementId === state.activeArrangementId;
        releaseAction?.();
        await Promise.all([actionExecution, switching]);

        expect(transitionWaitedForAction).toBe(true);
        expect(arrangementStore.value?.activeArrangementId).toBe(target.id);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toEqual([]);
    });

    it('waits for playback to stop before publishing and switching to a saved arrangement', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'target';
        target.tracks.tracks = [
            {
                id: 'track-1',
                name: 'Audio',
                kind: 'audio',
                muted: false,
                soloed: false,
                armed: false,
                gain: 1,
                pan: 0,
                color: '#fff',
                clips: [
                    {
                        id: 'clip-1',
                        trackId: 'track-1',
                        name: 'Clip 1',
                        startBeat: 0,
                        endBeat: 1,
                        type: 'audio',
                        audioBufferId: 'target-buffer',
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#fff',
                        locked: false,
                        muted: false,
                    },
                ],
                devices: [],
                sends: [],
                midiFx: [],
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
                alternatives: [],
                vcaGroupId: null,
                midiOutputTrackId: null,
                followChordTrack: false,
            },
        ];
        state.arrangements.push(target);
        arrangementStore.set(state);
        const setArrangement = vi.spyOn(arrangementStore, 'set');

        let completeStop: (() => void) | undefined;
        const stopCompletion = new Promise<void>((resolve) => {
            completeStop = resolve;
        });
        vi.mocked(stopPlayback).mockReturnValueOnce(stopCompletion);

        const switching = switchArrangement(target.id);
        await vi.waitFor(() => expect(stopPlayback).toHaveBeenCalledTimes(1));

        expect(prepareCachedAudioBuffersFromIdb).toHaveBeenCalledWith(
            expect.objectContaining({ bufferIds: ['target-buffer'] })
        );
        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(setArrangement).not.toHaveBeenCalled();
        expect(arrangementStore.value?.activeArrangementId).toBe(state.activeArrangementId);

        completeStop?.();
        await switching;

        expect(publishPreparedBuffers).toHaveBeenCalledTimes(1);
        expect(vi.mocked(stopPlayback).mock.invocationCallOrder[0]).toBeLessThan(
            publishPreparedBuffers.mock.invocationCallOrder[0]!
        );
        expect(setArrangement).toHaveBeenCalledTimes(2);
        expect(arrangementStore.value?.activeArrangementId).toBe(target.id);
    });

    it('revokes and awaits source freeze tasks before snapshotting or publishing the target arrangement', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'target-after-freeze-settlement';
        state.arrangements.push(target);
        arrangementStore.set(state);
        let settle_freezes!: () => void;
        cancelFreezeTasksForProjectTransition.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                settle_freezes = resolve;
            })
        );

        const switching = switchArrangement(target.id);
        await vi.waitFor(() => expect(cancelFreezeTasksForProjectTransition).toHaveBeenCalledOnce());

        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(arrangementStore.value?.activeArrangementId).toBe(state.activeArrangementId);

        settle_freezes();
        await switching;

        expect(publishPreparedBuffers).toHaveBeenCalledOnce();
        expect(reconcileAdjustmentLayerStaleness).toHaveBeenCalledOnce();
        expect(cancelFreezeTasksForProjectTransition.mock.invocationCallOrder[0]).toBeLessThan(
            publishPreparedBuffers.mock.invocationCallOrder[0]!
        );
    });

    it('switches to a legacy frozen arrangement without ever publishing it as current', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'legacy-target';
        target.tracks.tracks = [
            create_snapshot_track({
                id: 'legacy-frozen-track',
                frozen: true,
                frozenBufferId: 'legacy-buffer',
                freezeState: {
                    status: 'frozen',
                    frozenBufferId: 'legacy-buffer',
                    sourceContentHash: 'legacy-content-hash',
                },
            }),
        ];
        state.arrangements.push(target);
        arrangementStore.set(state);
        const published_statuses: string[] = [];
        const unsubscribe = trackStore.subscribe((track_state) => {
            const status = track_state?.tracks.find((track) => track.id === 'legacy-frozen-track')?.freezeState.status;
            if (status) {
                published_statuses.push(status);
            }
        });

        await switchArrangement(target.id);
        unsubscribe();

        expect(trackStore.value?.tracks[0]?.freezeState).toMatchObject({
            status: 'stale',
            sourceContentHash: 'legacy-content-hash',
        });
        expect(published_statuses).toEqual(['stale']);
    });

    it('propagates a playback stop failure without mutating the arrangement', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'target';
        state.arrangements.push(target);
        arrangementStore.set(state);

        const stopError = new Error('recording flush failed');
        vi.mocked(stopPlayback).mockRejectedValueOnce(stopError);

        await expect(switchArrangement(target.id)).rejects.toBe(stopError);

        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(arrangementStore.value?.activeArrangementId).toBe(state.activeArrangementId);
    });

    it('cancels a switch that becomes stale while playback is stopping', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'target';
        state.arrangements.push(target);
        arrangementStore.set(state);

        let completeStop: (() => void) | undefined;
        const stopCompletion = new Promise<void>((resolve) => {
            completeStop = resolve;
        });
        vi.mocked(stopPlayback).mockReturnValueOnce(stopCompletion);

        const switching = switchArrangement(target.id);
        await vi.waitFor(() => expect(stopPlayback).toHaveBeenCalledTimes(1));
        await switchArrangement(state.activeArrangementId);

        completeStop?.();
        await switching;

        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(arrangementStore.value?.activeArrangementId).toBe(state.activeArrangementId);
    });

    it('cancels a switch when a project load activates while playback is stopping', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'target';
        state.arrangements.push(target);
        arrangementStore.set(state);
        const setArrangement = vi.spyOn(arrangementStore, 'set');

        vi.mocked(stopPlayback).mockImplementationOnce(async () => {
            const newerLoad = runProjectLoadTransaction();
            await newerLoad.prepare();
            newerLoad.activate();
        });
        // Ignore store writes from setup and the project-load transaction; only switch writes matter.
        setArrangement.mockClear();

        await switchArrangement(target.id);

        expect(stopPlayback).toHaveBeenCalledTimes(1);
        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(setArrangement).not.toHaveBeenCalled();
        expect(markDirty).not.toHaveBeenCalled();
        expect(arrangementStore.value?.activeArrangementId).toBe(state.activeArrangementId);
    });

    it('cancels a switch when the active arrangement changes while playback is stopping', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'target';
        state.arrangements.push(target);
        arrangementStore.set(state);

        vi.mocked(stopPlayback).mockImplementationOnce(async () => {
            await Promise.resolve();
            arrangementStore.set({ ...arrangementStore.value!, activeArrangementId: 'switched-elsewhere' });
        });

        await switchArrangement(target.id);

        expect(stopPlayback).toHaveBeenCalledTimes(1);
        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(markDirty).not.toHaveBeenCalled();
        expect(arrangementStore.value?.activeArrangementId).toBe('switched-elsewhere');
    });

    it('cancels a switch when the target arrangement is removed while playback is stopping', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'target';
        state.arrangements.push(target);
        arrangementStore.set(state);

        vi.mocked(stopPlayback).mockImplementationOnce(async () => {
            await Promise.resolve();
            arrangementStore.set({
                ...arrangementStore.value!,
                arrangements: arrangementStore.value!.arrangements.filter(
                    (arrangement) => arrangement.id !== target.id
                ),
            });
        });

        await switchArrangement(target.id);

        expect(stopPlayback).toHaveBeenCalledTimes(1);
        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(markDirty).not.toHaveBeenCalled();
        expect(arrangementStore.value?.activeArrangementId).toBe(state.activeArrangementId);
        expect(arrangementStore.value?.arrangements.some((arrangement) => arrangement.id === target.id)).toBe(false);
    });

    it('cancels a pending switch when another project load activates', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'same-id-in-both-projects';
        state.arrangements.push(target);
        arrangementStore.set(state);
        let completePreparation: (() => void) | undefined;
        prepareCachedAudioBuffersFromIdb.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    completePreparation = () => resolve({ publish: publishPreparedBuffers });
                })
        );

        const switching = switchArrangement(target.id);
        await vi.waitFor(() => expect(completePreparation).toBeDefined());
        const newerLoad = runProjectLoadTransaction();
        await newerLoad.prepare();
        newerLoad.activate();
        completePreparation?.();
        await switching;

        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(arrangementStore.value?.activeArrangementId).toBe(state.activeArrangementId);
    });

    it('cancels a pending switch when the active arrangement is selected again', async () => {
        const state = structuredClone(defaultArrangementStoreState);
        const target = structuredClone(state.arrangements[0]!);
        target.id = 'target';
        state.arrangements.push(target);
        arrangementStore.set(state);
        let completePreparation: (() => void) | undefined;
        prepareCachedAudioBuffersFromIdb.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    completePreparation = () => resolve({ publish: publishPreparedBuffers });
                })
        );

        const switching = switchArrangement(target.id);
        await vi.waitFor(() => expect(completePreparation).toBeDefined());
        await switchArrangement(state.activeArrangementId);
        completePreparation?.();
        await switching;

        expect(publishPreparedBuffers).not.toHaveBeenCalled();
        expect(arrangementStore.value?.activeArrangementId).toBe(state.activeArrangementId);
    });
});
