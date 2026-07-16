import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { stopPlayback } from '#/modules/Transport/useCases';

import { arrangementStore, defaultArrangementStoreState } from '../../stores/arrangementStore';
import { switchArrangement } from '../arrangement/switchArrangement';
import { runProjectLoadTransaction } from '../projectPersistence/helpers/runProjectLoadTransaction';
import { setProjectIdentityTransitionDependencies } from '../projectPersistence/projectIdentityTransitionDependencies';
import { markDirty } from '../projectPersistence/saveProject/markDirty';

const { cancelPendingAudioBufferImport, prepareCachedAudioBuffersFromIdb, publishPreparedBuffers } = vi.hoisted(() => ({
    cancelPendingAudioBufferImport: vi.fn(),
    prepareCachedAudioBuffersFromIdb: vi.fn(),
    publishPreparedBuffers: vi.fn(() => 1),
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
vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        clearUndoHistory: vi.fn(),
    };
});

describe('switchArrangement', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        arrangementStore.set(structuredClone(defaultArrangementStoreState));
        prepareCachedAudioBuffersFromIdb.mockResolvedValue({ publish: publishPreparedBuffers });
    });

    it('does not call transport or persistence collaborators when switching to the active arrangement', async () => {
        const arrangementId = arrangementStore.value!.activeArrangementId;
        await switchArrangement(arrangementId);

        expect(stopPlayback).not.toHaveBeenCalled();
        expect(markDirty).not.toHaveBeenCalled();
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
                clips: [{ id: 'clip-1', startBeat: 0, endBeat: 1, audioBufferId: 'target-buffer' }],
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
