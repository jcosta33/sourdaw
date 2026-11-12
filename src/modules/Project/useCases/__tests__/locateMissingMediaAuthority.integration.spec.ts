import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Clip, type Track, trackStore } from '#/modules/Arrangement/stores';
import {
    createTrack,
    getArrangementHandlers,
    replaceClipAudioBuffer,
    readUndoHistoryAudioBufferIds,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, redo, resetActionReplayAuthority, undo } from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';
import {
    captureProjectRootIdentity,
    createCrdtDoc,
    getCrdtDoc,
    hasCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { pickFiles } from '../../repositories/nativeFileDialog/pickFiles';
import { type ArrangementSnapshot, arrangementStore } from '../../stores/arrangementStore';
import { missingMediaStore } from '../../stores/missingMediaStore';
import { defaultProjectStoreState, projectStore } from '../../stores/projectStore';
import { switchArrangement } from '../arrangement/switchArrangement';
import { locateMissingMedia } from '../locateMissingMedia';
import { captureProjectTransitionAuthority } from '../projectPersistence/captureProjectTransitionAuthority';
import { runProjectLoadTransaction } from '../projectPersistence/helpers/runProjectLoadTransaction';
import { verifyAudioBufferReferences } from '../projectPersistence/helpers/verifyAudioBufferReferences';
import { setProjectIdentityTransitionDependencies } from '../projectPersistence/projectIdentityTransitionDependencies';

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
vi.mock('../../repositories/nativeFileDialog/pickFiles', () => ({ pickFiles: vi.fn() }));
vi.mock('#/utils/Notification/confirmUser', () => ({ confirmUser: io.confirm }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

type Root = { tracks: { tracks: Track[] }; arrangements: { arrangements: ArrangementSnapshot[] } };

function clip(id: string): Clip {
    return {
        id,
        trackId: 'track-one',
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

function track(clips: Clip[]): Track {
    return { ...createTrack({ id: 'track-one', name: 'Track', kind: 'audio', withoutDefaultDevice: true }), clips };
}

function snapshot(id: string, clips: Clip[]): ArrangementSnapshot {
    return {
        id,
        name: id,
        tracks: { tracks: [track(clips)], selectedTrackId: null },
        automation: { lanes: [] },
        midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
    };
}

function rawClip(id = 'clip-a'): Clip {
    const found = getCrdtDoc<Root>('root')
        ?.tracks.tracks.flatMap((owner) => owner.clips)
        .find((item) => item.id === id);
    if (!found) {
        throw new Error(`Missing committed ${id}`);
    }
    return found;
}

describe('missing-media recovery through real CRDT and Command', () => {
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
        resetCrdtProjectAuthority('temporary missing media authority probe');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        agentProjectRepairStateStore.set(null);
        projectStore.set({ ...defaultProjectStoreState, loading: false, createdAt: 100, updatedAt: 100 });
        trackStore.set({ tracks: [track([clip('clip-a'), clip('clip-alias')])], selectedTrackId: null });
        arrangementStore.set({
            activeArrangementId: 'arr-a',
            arrangements: [snapshot('arr-a', []), snapshot('arr-b', [clip('clip-b')])],
        });
        flushAutomergeStorageWrites();
        verifyAudioBufferReferences();
        expect(rawClip().audioBufferId).toBe('missing');
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        clearUndoHistory();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        clearHandlerRegistry();
        vi.restoreAllMocks();
    });

    it('positive control commits Locate and actual Undo/Redo to raw CRDT', async () => {
        await locateMissingMedia({ sourceBufferId: 'missing', label: 'clip-a.wav' });
        flushAutomergeStorageWrites();
        expect(rawClip().audioBufferId).toBe('replacement');
        expect(rawClip('clip-alias').audioBufferId).toBe('replacement');
        expect(undoStore.value?.past).toHaveLength(1);
        const entry = undoHistoryStore.value?.past[0];
        expect(entry?.kind).toBe('action');
        if (entry?.kind !== 'action') {
            throw new Error('Expected a typed source-relink history entry');
        }
        expect(entry.action.type).toBe('relinkClipAudioSources');
        expect(entry.inverseAction?.type).toBe('relinkClipAudioSources');
        expect(readUndoHistoryAudioBufferIds()).toContain('replacement');
        expect(missingMediaStore.value?.items).toEqual([]);
        await undo();
        flushAutomergeStorageWrites();
        expect(rawClip().audioBufferId).toBe('missing');
        expect(readUndoHistoryAudioBufferIds()).toContain('replacement');
        await redo();
        flushAutomergeStorageWrites();
        expect(rawClip().audioBufferId).toBe('replacement');
    });

    it.each(['supported source replacement', 'authoritative CRDT publication'])(
        'preserves a later %s when undoing Locate',
        async (route) => {
            await locateMissingMedia({ sourceBufferId: 'missing', label: 'clip-a.wav' });
            flushAutomergeStorageWrites();
            expect(rawClip().audioBufferId).toBe('replacement');
            if (route === 'supported source replacement') {
                expect(replaceClipAudioBuffer('clip-a', 'later-authority')).toBe(true);
                flushAutomergeStorageWrites();
            } else {
                mutateCrdtDoc<Root>({
                    id: 'root',
                    message: 'peer source publication',
                    changeFn: (document) => {
                        const found = document.tracks.tracks[0]!.clips.find((item) => item.id === 'clip-a');
                        if (!found) {
                            throw new Error('Missing peer target');
                        }
                        found.audioBufferId = 'later-authority';
                        found.gain = 1.75;
                    },
                });
                trackStore.hydrate();
            }
            expect(rawClip().audioBufferId).toBe('later-authority');
            expect(trackStore.value?.tracks[0]?.clips[0]?.audioBufferId).toBe('later-authority');
            expect(undoStore.value?.past).toHaveLength(1);
            await undo();
            flushAutomergeStorageWrites();
            expect(rawClip().audioBufferId).toBe('later-authority');
        }
    );

    it('does not apply the outgoing arrangement picker result to the incoming arrangement', async () => {
        const picker = Promise.withResolvers<File[] | null>();
        vi.mocked(pickFiles).mockReturnValueOnce(picker.promise);
        const authority = captureProjectTransitionAuthority();
        const identity = captureProjectRootIdentity();
        const locating = locateMissingMedia({ sourceBufferId: 'missing', label: 'clip-a.wav' });
        expect(pickFiles).toHaveBeenCalledOnce();
        expect(rawClip().audioBufferId).toBe('missing');
        await switchArrangement('arr-b');
        flushAutomergeStorageWrites();
        expect(arrangementStore.value?.activeArrangementId).toBe('arr-b');
        expect(rawClip('clip-b').audioBufferId).toBe('missing');
        expect(authority.isCurrent()).toBe(true);
        expect(captureProjectRootIdentity()).toBe(identity);
        picker.resolve([new File(['audio'], 'replacement.wav')]);
        await locating;
        flushAutomergeStorageWrites();
        expect(rawClip('clip-b').audioBufferId).toBe('missing');
    });

    it('preserves a later source on Redo and leaves the whole relink unit unapplied', async () => {
        await locateMissingMedia({ sourceBufferId: 'missing', label: 'clip-a.wav' });
        await undo();
        flushAutomergeStorageWrites();
        expect(rawClip().audioBufferId).toBe('missing');
        expect(replaceClipAudioBuffer('clip-a', 'later-authority')).toBe(true);
        flushAutomergeStorageWrites();
        await redo();
        flushAutomergeStorageWrites();
        expect(rawClip().audioBufferId).toBe('later-authority');
        expect(rawClip('clip-alias').audioBufferId).toBe('missing');
        expect(undoStore.value?.future).toHaveLength(1);
    });

    it.each(['locked', 'frozen', 'owner kind', 'source clock', 'inactive alternative'] as const)(
        'refuses the entire Undo when %s authority changes without overwriting any alias',
        async (change) => {
            const state = trackStore.value;
            if (!state) {
                throw new Error('Expected the track fixture');
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((owner) => ({
                    ...owner,
                    alternatives: [
                        ...owner.alternatives,
                        { id: 'inactive', name: 'Inactive', clips: [clip('clip-alt')] },
                    ],
                })),
            });
            flushAutomergeStorageWrites();
            await locateMissingMedia({ sourceBufferId: 'missing', label: 'clip-a.wav' });
            expect(rawClip().audioBufferId).toBe('replacement');
            mutateCrdtDoc<Root>({
                id: 'root',
                changeFn: (document) => {
                    const owner = document.tracks.tracks[0]!;
                    if (change === 'locked') {
                        owner.clips[0]!.locked = true;
                    }
                    if (change === 'frozen') {
                        owner.frozen = true;
                    }
                    if (change === 'owner kind') {
                        owner.kind = 'vca';
                    }
                    if (change === 'source clock') {
                        owner.clips[0]!.audioOffsetBeats = 2;
                    }
                    if (change === 'inactive alternative') {
                        const inactive = owner.alternatives.find((item) => item.id === 'inactive');
                        if (!inactive?.clips[0]) {
                            throw new Error('Expected a relinked inactive alias');
                        }
                        inactive.clips[0].audioBufferId = 'later-authority';
                    }
                },
            });
            trackStore.hydrate();
            const before = JSON.stringify(getCrdtDoc<Root>('root')?.tracks);
            const headId = undoHistoryStore.value?.past[0]?.id;
            await undo();
            flushAutomergeStorageWrites();
            expect(JSON.stringify(getCrdtDoc<Root>('root')?.tracks)).toBe(before);
            expect(undoHistoryStore.value?.past[0]?.id).toBe(headId);
            expect(undoHistoryStore.value?.future).toEqual([]);
        }
    );

    it('keeps a later unrelated gain edit while undoing every source alias', async () => {
        await locateMissingMedia({ sourceBufferId: 'missing', label: 'clip-a.wav' });
        mutateCrdtDoc<Root>({
            id: 'root',
            changeFn: (document) => {
                document.tracks.tracks[0]!.clips[0]!.gain = 1.75;
            },
        });
        trackStore.hydrate();
        await undo();
        flushAutomergeStorageWrites();
        expect(rawClip()).toMatchObject({ audioBufferId: 'missing', gain: 1.75 });
        expect(rawClip('clip-alias').audioBufferId).toBe('missing');
    });

    it('discards an uncommitted decode when real source publication fails', async () => {
        configureAutomergeStoragePort({
            getDoc: (id) => getCrdtDoc<Record<string, unknown>>(id),
            hasDoc: hasCrdtDoc,
            getSemanticMessage: () => undefined,
            mutateDoc: () => {
                throw new Error('Source publication failed');
            },
        });
        await expect(locateMissingMedia({ sourceBufferId: 'missing', label: 'clip-a.wav' })).rejects.toThrow(
            'Source publication failed'
        );
        registerCrdtStorageRuntime();
        expect(rawClip().audioBufferId).toBe('missing');
        expect(io.discard).toHaveBeenCalledExactlyOnceWith('replacement');
        expect(undoHistoryStore.value?.past).toEqual([]);
    });

    it('refuses a peer source edit arriving after staging but before publication', async () => {
        const handler = getArrangementHandlers().relinkClipAudioSources;
        const execute = handler.execute;
        vi.spyOn(handler, 'execute').mockImplementation(async (action, context) => {
            const result = await execute(action, context);
            mutateCrdtDoc<Root>({
                id: 'root',
                message: 'peer source after staging',
                changeFn: (document) => {
                    document.tracks.tracks[0]!.clips[0]!.audioBufferId = 'late-peer-source';
                    document.tracks.tracks[0]!.clips[0]!.gain = 1.75;
                },
            });
            trackStore.hydrate({ keepLocalRuntimeState: true });
            return result;
        });
        await locateMissingMedia({ sourceBufferId: 'missing', label: 'clip-a.wav' });
        flushAutomergeStorageWrites();
        expect(rawClip()).toMatchObject({ audioBufferId: 'late-peer-source', gain: 1.75 });
        expect(rawClip('clip-alias').audioBufferId).toBe('missing');
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioBufferId).toBe('late-peer-source');
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(io.discard).toHaveBeenCalledExactlyOnceWith('replacement');
    });

    it('refuses atomically when a nested projection rebase cannot retain the staged source edit', async () => {
        const handler = getArrangementHandlers().relinkClipAudioSources;
        const execute = handler.execute;
        vi.spyOn(handler, 'execute').mockImplementation(async (action, context) => {
            const result = await execute(action, context);
            mutateCrdtDoc<Root>({
                id: 'root',
                message: 'peer gain after staging',
                changeFn: (document) => {
                    document.tracks.tracks[0]!.clips[0]!.gain = 1.75;
                },
            });
            trackStore.hydrate({ keepLocalRuntimeState: true });
            return result;
        });
        await locateMissingMedia({ sourceBufferId: 'missing', label: 'clip-a.wav' });
        flushAutomergeStorageWrites();
        // An overlapping nested row takes peer truth; a dropped source intent must not report a commit.
        expect(rawClip()).toMatchObject({ audioBufferId: 'missing', gain: 1.75 });
        expect(rawClip('clip-alias').audioBufferId).toBe('missing');
        expect(trackStore.value?.tracks[0]?.clips[0]).toMatchObject({ audioBufferId: 'missing', gain: 1.75 });
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(io.discard).toHaveBeenCalledExactlyOnceWith('replacement');
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('could not relink'), 'error');
    });

    it('retains committed PCM and reports success when real history publication reports a later failure', async () => {
        const publish = undoHistoryStore.set;
        vi.spyOn(undoHistoryStore, 'set').mockImplementation((next) => {
            publish(next);
            if (next?.past.at(-1)?.kind === 'action') {
                throw new Error('History observer failed after source commit');
            }
        });
        await locateMissingMedia({ sourceBufferId: 'missing', label: 'clip-a.wav' });
        expect(rawClip().audioBufferId).toBe('replacement');
        expect(missingMediaStore.value?.items).toEqual([]);
        expect(io.discard).not.toHaveBeenCalled();
        expect(readUndoHistoryAudioBufferIds()).toContain('replacement');
    });

    it('discards decoded media after switching away and back to the originating arrangement', async () => {
        const entered = Promise.withResolvers<void>();
        const decoded = Promise.withResolvers<{ id: string; buffer: AudioBuffer }>();
        io.decode.mockImplementationOnce(() => {
            entered.resolve();
            return decoded.promise;
        });
        const locating = locateMissingMedia({ sourceBufferId: 'missing', label: 'clip-a.wav' });
        await entered.promise;
        await switchArrangement('arr-b');
        await switchArrangement('arr-a');
        expect(arrangementStore.value?.activeArrangementId).toBe('arr-a');
        decoded.resolve({ id: 'stale-decoded', buffer: MockAudioBuffer.create(1, 8, 48000) });
        await locating;
        flushAutomergeStorageWrites();
        expect(rawClip().audioBufferId).toBe('missing');
        expect(io.discard).toHaveBeenCalledExactlyOnceWith('stale-decoded');
        expect(undoStore.value?.past).toEqual([]);
    });

    it('abandons the optional multi-file picker after its originating arrangement changes', async () => {
        const state = trackStore.value!;
        trackStore.set({
            ...state,
            tracks: state.tracks.map((owner) => ({
                ...owner,
                clips: [...owner.clips, { ...clip('clip-second'), audioBufferId: 'missing-second' }],
            })),
        });
        flushAutomergeStorageWrites();
        verifyAudioBufferReferences();
        const entered = Promise.withResolvers<void>();
        const picker = Promise.withResolvers<File[] | null>();
        vi.mocked(pickFiles)
            .mockResolvedValueOnce([new File(['audio'], 'first.wav')])
            .mockImplementationOnce(() => {
                entered.resolve();
                return picker.promise;
            });
        io.confirm.mockResolvedValueOnce(true);
        const locating = locateMissingMedia({ sourceBufferId: 'missing', label: 'clip-a.wav' });
        await entered.promise;
        await switchArrangement('arr-b');
        picker.resolve([new File(['audio'], 'clip-second.wav')]);
        await locating;
        flushAutomergeStorageWrites();
        expect(rawClip('clip-b').audioBufferId).toBe('missing');
        expect(io.decode).toHaveBeenCalledTimes(1);
        expect(undoHistoryStore.value?.past).toEqual([]);
    });
});
