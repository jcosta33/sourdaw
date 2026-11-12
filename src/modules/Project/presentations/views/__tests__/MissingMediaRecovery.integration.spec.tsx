import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Clip, type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, unfreezeTrack } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, redo, resetActionReplayAuthority, undo } from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { pickFiles } from '../../../repositories/nativeFileDialog/pickFiles';
import { arrangementStore } from '../../../stores/arrangementStore';
import { missingMediaStore } from '../../../stores/missingMediaStore';
import { defaultProjectStoreState, projectStore } from '../../../stores/projectStore';
import { locateMissingMedia } from '../../../useCases/locateMissingMedia';
import { runProjectLoadTransaction } from '../../../useCases/projectPersistence/helpers/runProjectLoadTransaction';
import { verifyAudioBufferReferences } from '../../../useCases/projectPersistence/helpers/verifyAudioBufferReferences';
import { setProjectIdentityTransitionDependencies } from '../../../useCases/projectPersistence/projectIdentityTransitionDependencies';
import { MissingMediaPanel } from '../MissingMediaPanel';

const io = vi.hoisted(() => ({
    buffers: new Map<string, AudioBuffer>(),
    decode: vi.fn(),
    discard: vi.fn(),
    confirm: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getCachedAudioBuffer: ({ bufferId }: { bufferId: string }) => io.buffers.get(bufferId) ?? null,
    decodeAudioFile: io.decode,
    discardDecodedAudioFile: io.discard,
    getAudioContext: () => null,
    prepareCachedAudioBuffersFromIdb: async () => ({ publish: () => undefined, cancel: () => undefined }),
}));
vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    stopPlayback: async () => undefined,
}));
vi.mock('../../../repositories/nativeFileDialog/pickFiles', () => ({ pickFiles: vi.fn() }));
vi.mock('#/utils/Notification/confirmUser', () => ({ confirmUser: io.confirm }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

type Root = { tracks: { tracks: Track[] } };

function clip(id: string, trackId: string): Clip {
    return {
        id,
        trackId,
        name: `${id}.wav`,
        type: 'audio',
        audioBufferId: 'missing',
        startBeat: 0,
        endBeat: 4,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
}

function track(id: string, clips: Clip[]): Track {
    return { ...createTrack({ id, name: id, kind: 'audio', withoutDefaultDevice: true }), clips };
}

function rawClip(id: string): Clip {
    const found = getCrdtDoc<Root>('root')
        ?.tracks.tracks.flatMap((owner) => owner.clips)
        .find((item) => item.id === id);
    if (!found) {
        throw new Error(`Missing committed ${id}`);
    }
    return found;
}

describe('MissingMediaPanel frozen source recovery', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        io.buffers.clear();
        io.confirm.mockResolvedValue(false);
        io.decode.mockImplementation(async () => {
            const buffer = MockAudioBuffer.create(1, 8, 48000);
            io.buffers.set('replacement', buffer);
            return { id: 'replacement', buffer };
        });
        vi.mocked(pickFiles).mockResolvedValue([new File(['audio'], 'replacement.wav')]);
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => undefined });
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('missing media panel integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        agentProjectRepairStateStore.set(null);
        projectStore.set({ ...defaultProjectStoreState, loading: false, createdAt: 100, updatedAt: 100 });
        arrangementStore.set({ activeArrangementId: 'arr-a', arrangements: [] });
    });

    afterEach(() => {
        cleanup();
        flushAutomergeStorageWrites();
        clearUndoHistory();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        clearHandlerRegistry();
        vi.restoreAllMocks();
    });

    it('withholds Locate for every alias until its frozen owner is unfrozen', async () => {
        const frozen = {
            ...track('track-one', [clip('clip-a', 'track-one'), clip('clip-alias', 'track-one')]),
            frozen: true,
            freezeState: { status: 'frozen' as const, frozenBufferId: 'frozen-render' },
        };
        const other = track('track-two', [clip('other', 'track-two')]);
        trackStore.set({ tracks: [frozen, other], selectedTrackId: null });
        io.buffers.set('frozen-render', MockAudioBuffer.create(1, 8, 48000));
        flushAutomergeStorageWrites();
        verifyAudioBufferReferences();
        expect(missingMediaStore.value?.items.map(({ kind, clipId }) => ({ kind, clipId }))).toEqual([
            { kind: 'clip', clipId: 'clip-a' },
            { kind: 'clip', clipId: 'clip-alias' },
            { kind: 'clip', clipId: 'other' },
        ]);
        const before = JSON.stringify(getCrdtDoc<Root>('root')?.tracks);
        const view = render(<MissingMediaPanel />);
        fireEvent.click(screen.getByRole('button', { name: /1 missing file/ }));
        expect(screen.getAllByText(/Unfreeze/)).toHaveLength(3);
        expect(screen.queryByRole('button', { name: 'Locate…' })).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Reveal clip' })).toHaveLength(3);
        await act(async () => {
            await locateMissingMedia({ sourceBufferId: 'missing', label: 'clip-a.wav' });
        });
        expect(pickFiles).not.toHaveBeenCalled();
        expect(io.decode).not.toHaveBeenCalled();
        expect(io.discard).not.toHaveBeenCalled();
        expect(JSON.stringify(getCrdtDoc<Root>('root')?.tracks)).toBe(before);
        expect(undoHistoryStore.value?.past).toHaveLength(0);

        act(() => {
            unfreezeTrack('track-one');
            flushAutomergeStorageWrites();
        });
        expect(getCrdtDoc<Root>('root')?.tracks.tracks[0]?.freezeState.status).toBe('unfrozen');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Locate…' })).toBeEnabled());
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Locate…' })));
        await waitFor(() => expect(rawClip('other').audioBufferId).toBe('replacement'));
        expect(rawClip('clip-a').audioBufferId).toBe('replacement');
        expect(rawClip('clip-alias').audioBufferId).toBe('replacement');
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        view.unmount();
        await undo();
        expect(rawClip('clip-a').audioBufferId).toBe('missing');
        expect(rawClip('other').audioBufferId).toBe('missing');
        await redo();
        expect(rawClip('clip-alias').audioBufferId).toBe('replacement');
        expect(notifyUser).not.toHaveBeenCalledWith(expect.stringContaining('could not relink'), 'error');
    });
});
