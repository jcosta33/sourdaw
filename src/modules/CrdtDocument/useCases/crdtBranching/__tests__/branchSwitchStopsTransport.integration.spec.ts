import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { defaultTransportState, playheadPositionRef, transportStore } from '#/modules/Transport/stores';

import { DOC_PREFIX_ROOT } from '../../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../../repositories/automergeRepository';
import { branchStore } from '../../../stores/branchStore';
import { mutateCrdtDoc } from '../../mutateCrdtDoc';
import { runCrdtPersistenceOperation } from '../../runCrdtPersistenceOperation';
import { forkProjectBranch } from '../forkProjectBranch';
import { switchBranch } from '../switchBranch';

// A branch switch replaces the root document with another branch's, so a
// transport left running would keep recording into the incoming branch and the
// switch would clear undo mid-take. The switch stops the transport first, and a
// recording in flight commits its take while the outgoing branch is still root.

type TakeDocument = { take?: string };

const TAKE_MARKER = 'take-recorded-on-outgoing-branch';
const PLAYHEAD_BEAT = 12;

const mocks = vi.hoisted(() => ({
    commitTake: vi.fn<() => Promise<void>>(),
    stopAudioRecording: vi.fn<() => Promise<void>>(() => Promise.resolve()),
}));

vi.mock('../../compactProject', () => ({ compactProject: vi.fn(() => Promise.resolve()) }));
vi.mock('../../runCrdtPersistenceOperation', () => ({
    runCrdtPersistenceOperation: vi.fn(() => Promise.resolve()),
}));
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    stopRecording: mocks.commitTake,
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    audioEngine: { setTransportInfo: vi.fn() },
    getAudioContext: vi.fn(() => ({ currentTime: 1, sampleRate: 48000 })),
    stopAllScheduled: vi.fn(),
    stopAudioRecording: mocks.stopAudioRecording,
    stopNativeLiveGraphSession: vi.fn(() => Promise.resolve({ outcome: 'declined', reason: 'no session' })),
}));
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    resetMidiState: vi.fn(),
}));
vi.mock('#/modules/Yeast/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Yeast/useCases')>()),
    yeastPanic: vi.fn(() => Promise.resolve()),
}));

function readTake(docId: string): string | undefined {
    return automergeRepository.getDoc<TakeDocument>(docId)?.take;
}

function activeBranchBackingDocId(): string {
    const state = branchStore.value;
    const active = state?.branches.find(({ branchId }) => branchId === state.activeBranchId);
    if (!active) {
        throw new Error('Expected an active branch record');
    }
    return active.rootDocId === DOC_PREFIX_ROOT ? `branch_${active.branchId}` : active.rootDocId;
}

function startRecordingSession(): void {
    transportStore.set({
        ...defaultTransportState,
        isPlaying: true,
        isRecording: true,
        overdubEnabled: true,
        playheadPosition: PLAYHEAD_BEAT,
    });
    playheadPositionRef.current = PLAYHEAD_BEAT;
}

describe('branch switch stops the transport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        automergeRepository.reset();
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        automergeRepository.createProject('branch transport test');
        branchStore.set({
            branches: [
                {
                    branchId: 'main',
                    name: 'Main',
                    rootDocId: 'root',
                    sourceBranchId: null,
                    createdAt: 1,
                    createdFromHeads: [],
                    note: '',
                },
            ],
            activeBranchId: 'main',
        });
        mocks.stopAudioRecording.mockResolvedValue(undefined);
        // The commit is the take landing on whichever document is root when it
        // runs, and only a stop that finds the transport recording has one.
        mocks.commitTake.mockImplementation(() => {
            if (!transportStore.value?.isRecording) {
                return Promise.resolve();
            }
            mutateCrdtDoc<TakeDocument>({
                id: DOC_PREFIX_ROOT,
                changeFn: (draft) => {
                    draft.take = TAKE_MARKER;
                },
            });
            return Promise.resolve();
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        transportStore.set(defaultTransportState);
        automergeRepository.reset();
    });

    it('stops a playing and recording session and commits the take to the outgoing branch', async () => {
        await forkProjectBranch('feature');
        const outgoingDocId = activeBranchBackingDocId();
        startRecordingSession();

        const originalReplace = automergeRepository.replaceDoc.bind(automergeRepository);
        let transportAtRootReplace: typeof transportStore.value | undefined = undefined;
        let takeAtRootReplace: string | undefined;
        vi.spyOn(automergeRepository, 'replaceDoc').mockImplementation((id, doc, tx) => {
            if (id === DOC_PREFIX_ROOT) {
                transportAtRootReplace = transportStore.value;
                takeAtRootReplace = readTake(DOC_PREFIX_ROOT);
            }
            originalReplace(id, doc, tx);
        });

        await switchBranch('main');

        expect(mocks.commitTake).toHaveBeenCalledTimes(1);
        expect(takeAtRootReplace).toBe(TAKE_MARKER);
        expect(transportAtRootReplace).toMatchObject({ isPlaying: false, isRecording: false });
        expect(transportStore.value).toMatchObject({
            isPlaying: false,
            isRecording: false,
            playheadPosition: 0,
        });
        expect(readTake(outgoingDocId)).toBe(TAKE_MARKER);
        expect(readTake(DOC_PREFIX_ROOT)).toBeUndefined();
    });

    it('refuses to replace the root when Record or Play starts while the stop is still flushing', async () => {
        await forkProjectBranch('feature');
        const outgoingBranchId = branchStore.value?.activeBranchId;
        const outgoingDocId = activeBranchBackingDocId();
        startRecordingSession();

        let releaseFlush: () => void = () => undefined;
        mocks.stopAudioRecording.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseFlush = resolve;
                })
        );
        const originalReplace = automergeRepository.replaceDoc.bind(automergeRepository);
        const transportAtEveryRootReplace: Array<typeof transportStore.value> = [];
        vi.spyOn(automergeRepository, 'replaceDoc').mockImplementation((id, doc, tx) => {
            if (id === DOC_PREFIX_ROOT) {
                transportAtEveryRootReplace.push(transportStore.value);
            }
            originalReplace(id, doc, tx);
        });

        const switching = switchBranch('main');
        const switchOutcome = expect(switching).rejects.toThrow('The transport started while switching branches');
        // The stop already published an idle transport; Record pressed now is
        // not blocked, and the flush it is waiting on has not landed yet.
        expect(transportStore.value).toMatchObject({ isPlaying: false, isRecording: false });
        transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: true, overdubEnabled: true });
        releaseFlush();
        await switchOutcome;

        expect(transportAtEveryRootReplace).toEqual([]);
        expect(branchStore.value?.activeBranchId).toBe(outgoingBranchId);
        expect(transportStore.value).toMatchObject({ isPlaying: true, isRecording: true });
        expect(mocks.commitTake).toHaveBeenCalledTimes(1);
        expect(readTake(outgoingDocId)).toBeUndefined();
        expect(readTake(DOC_PREFIX_ROOT)).toBe(TAKE_MARKER);
    });

    it('keeps the outgoing branch active when the transport cannot stop', async () => {
        await forkProjectBranch('feature');
        const activeBeforeSwitch = branchStore.value?.activeBranchId;
        startRecordingSession();
        mocks.stopAudioRecording.mockRejectedValueOnce(new Error('recorder would not flush'));
        const replaceSpy = vi.spyOn(automergeRepository, 'replaceDoc');

        await expect(switchBranch('main')).rejects.toThrow('recorder would not flush');

        expect(replaceSpy).not.toHaveBeenCalled();
        expect(branchStore.value?.activeBranchId).toBe(activeBeforeSwitch);
    });

    function holdNextPersistence(): { reject: (reason: Error) => void } {
        let rejectHeld: (reason: Error) => void = () => undefined;
        vi.mocked(runCrdtPersistenceOperation).mockImplementationOnce(
            () =>
                new Promise<void>((_resolve, reject) => {
                    rejectHeld = reject;
                })
        );
        return { reject: (reason) => rejectHeld(reason) };
    }

    function incomingBackingDocId(branchId: string): string {
        const incoming = branchStore.value?.branches.find((branch) => branch.branchId === branchId);
        if (!incoming) {
            throw new Error('Expected the incoming branch record');
        }
        return incoming.rootDocId;
    }

    it('stops a transport started while the switch persisted, then restores the outgoing branch', async () => {
        await forkProjectBranch('feature');
        const outgoingBranchId = branchStore.value?.activeBranchId;
        const outgoingDocId = activeBranchBackingDocId();
        const incomingDocId = incomingBackingDocId('main');
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const persistence = holdNextPersistence();

        const switching = switchBranch('main');
        const switchOutcome = expect(switching).rejects.toThrow('quota exceeded');
        await vi.waitFor(() => expect(branchStore.value?.activeBranchId).toBe('main'));
        // A Record press while the switch is persisting finds an idle transport
        // and an incoming root, so nothing refuses it.
        startRecordingSession();
        persistence.reject(new Error('quota exceeded'));
        await switchOutcome;

        expect(branchStore.value?.activeBranchId).toBe(outgoingBranchId);
        expect(transportStore.value).toMatchObject({ isPlaying: false, isRecording: false });
        // One stop before the switch, one before its rollback.
        expect(mocks.commitTake).toHaveBeenCalledTimes(2);
        // The take committed onto the incoming root, which the restore replaced:
        // it is on neither branch, and the user is told.
        expect(readTake(DOC_PREFIX_ROOT)).toBeUndefined();
        expect(readTake(outgoingDocId)).toBeUndefined();
        expect(readTake(incomingDocId)).toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('take committed during the rollback is discarded'));
    });

    it('does not report a discarded take when nothing was recording at the rollback', async () => {
        await forkProjectBranch('feature');
        const outgoingBranchId = branchStore.value?.activeBranchId;
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const persistence = holdNextPersistence();

        const switching = switchBranch('main');
        const switchOutcome = expect(switching).rejects.toThrow('quota exceeded');
        await vi.waitFor(() => expect(branchStore.value?.activeBranchId).toBe('main'));
        persistence.reject(new Error('quota exceeded'));
        await switchOutcome;

        expect(branchStore.value?.activeBranchId).toBe(outgoingBranchId);
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('discarded'));
    });

    it('stops the transport before the outgoing snapshot is restored', async () => {
        await forkProjectBranch('feature');
        const persistence = holdNextPersistence();
        const originalReplace = automergeRepository.replaceDoc.bind(automergeRepository);
        const replaces: Array<{ id: string; transport: typeof transportStore.value }> = [];
        vi.spyOn(automergeRepository, 'replaceDoc').mockImplementation((id, doc, tx) => {
            replaces.push({ id, transport: transportStore.value });
            originalReplace(id, doc, tx);
        });

        const switching = switchBranch('main');
        const switchOutcome = expect(switching).rejects.toThrow('quota exceeded');
        await vi.waitFor(() => expect(branchStore.value?.activeBranchId).toBe('main'));
        startRecordingSession();
        replaces.length = 0;
        persistence.reject(new Error('quota exceeded'));
        await switchOutcome;

        const restores = replaces.filter(({ id }) => id === DOC_PREFIX_ROOT || id.startsWith('branch_'));
        expect(restores.length).toBeGreaterThan(0);
        for (const { transport } of restores) {
            expect(transport).toMatchObject({ isPlaying: false, isRecording: false });
        }
    });

    it('still restores the outgoing branch when the stop fails', async () => {
        await forkProjectBranch('feature');
        const outgoingBranchId = branchStore.value?.activeBranchId;
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const persistence = holdNextPersistence();

        const switching = switchBranch('main');
        const switchOutcome = expect(switching).rejects.toThrow('quota exceeded');
        await vi.waitFor(() => expect(branchStore.value?.activeBranchId).toBe('main'));
        startRecordingSession();
        mocks.stopAudioRecording.mockRejectedValueOnce(new Error('recorder would not flush'));
        persistence.reject(new Error('quota exceeded'));
        await switchOutcome;

        expect(branchStore.value?.activeBranchId).toBe(outgoingBranchId);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('Failed to stop the transport before the branch rollback'),
            expect.objectContaining({ message: 'recorder would not flush' })
        );
    });

    it('keeps the transport running when a fork rolls back, because a fork stays on one lineage', async () => {
        const persistence = holdNextPersistence();
        const originalReplace = automergeRepository.replaceDoc.bind(automergeRepository);
        let rootReplaced = false;
        vi.spyOn(automergeRepository, 'replaceDoc').mockImplementation((id, doc, tx) => {
            rootReplaced ||= id === DOC_PREFIX_ROOT;
            originalReplace(id, doc, tx);
        });

        const forking = forkProjectBranch('feature');
        const forkOutcome = expect(forking).rejects.toThrow('quota exceeded');
        await vi.waitFor(() => expect(rootReplaced).toBe(true));
        startRecordingSession();
        persistence.reject(new Error('quota exceeded'));
        await forkOutcome;

        expect(branchStore.value?.activeBranchId).toBe('main');
        expect(transportStore.value).toMatchObject({ isPlaying: true, isRecording: true });
        expect(mocks.commitTake).not.toHaveBeenCalled();
    });
});
