import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Clip, type Track, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    removeCrdtDoc,
    registerCrdtStorageRuntime,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { clearClipPitchAnalysis } from '#/modules/Knead/useCases';
import { confirmUser } from '#/utils/Notification/confirmUser';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { pickFiles as pickFilesFromNativeDialog } from '../../repositories/nativeFileDialog/pickFiles';
import { arrangementStore } from '../../stores/arrangementStore';
import { defaultMissingMediaStoreState, missingMediaStore } from '../../stores/missingMediaStore';
import { projectStore, defaultProjectStoreState } from '../../stores/projectStore';
import { locateMissingMedia } from '../locateMissingMedia';
import { verifyAudioBufferReferences } from '../projectPersistence/helpers/verifyAudioBufferReferences';

const mocks = vi.hoisted(() => ({
    buffers: new Map<string, AudioBuffer>(),
    decodeAudioFile: vi.fn(),
    discardDecodedAudioFile: vi.fn(),
    isCurrentProject: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/stores', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/AudioEngine/stores')>();
    return {
        ...original,
        audioBufferCache: { ...original.audioBufferCache, has: (bufferId: string) => mocks.buffers.has(bufferId) },
    };
});
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    decodeAudioFile: mocks.decodeAudioFile,
    discardDecodedAudioFile: mocks.discardDecodedAudioFile,
    getCachedAudioBuffer: ({ bufferId }: { bufferId: string }) => mocks.buffers.get(bufferId) ?? null,
}));
vi.mock('#/modules/Knead/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Knead/useCases')>()),
    clearClipPitchAnalysis: vi.fn(),
}));
vi.mock('../projectPersistence/captureProjectTransitionAuthority', () => ({
    captureProjectTransitionAuthority: () => ({ isCurrent: mocks.isCurrentProject }),
}));
vi.mock('#/utils/Notification/confirmUser', () => ({ confirmUser: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('../../repositories/nativeFileDialog/pickFiles', () => ({ pickFiles: vi.fn() }));

function audioClip(id: string, trackId: string, bufferId: string, name: string): Clip {
    return {
        id,
        trackId,
        name,
        startBeat: 0,
        endBeat: 8,
        type: 'audio',
        audioBufferId: bufferId,
        audioOffsetBeats: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
}

function trackForClip(clip: Clip): Track {
    return {
        id: clip.trackId,
        name: clip.trackId,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '',
        clips: [clip],
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
        activeAlternativeId: `${clip.trackId}-alt`,
        alternatives: [{ id: `${clip.trackId}-alt`, name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function arrange(clips: Clip[]): void {
    trackStore.set({
        tracks: clips.map(trackForClip),
        selectedTrackId: null,
    });
    missingMediaStore.set({
        items: clips.map((clip) => ({
            bufferId: clip.audioBufferId!,
            clipId: clip.id,
            kind: 'clip',
            label: clip.name,
            trackId: clip.trackId,
            trackName: clip.trackId,
        })),
    });
    flushAutomergeStorageWrites();

    const rawTracks = getCrdtDoc<{ tracks?: NonNullable<(typeof trackStore)['value']> }>('root')?.tracks?.tracks;
    expect(rawTracks).toBeDefined();
    expect(
        rawTracks?.map((track) => ({
            trackId: track.id,
            clips: track.clips.map((clip) => ({ id: clip.id, sourceBufferId: clip.audioBufferId })),
        }))
    ).toEqual(
        clips.map((clip) => ({
            trackId: clip.trackId,
            clips: [{ id: clip.id, sourceBufferId: clip.audioBufferId }],
        }))
    );
}

function replacement(name: string): File {
    return new File([new Uint8Array(8)], name, { type: 'audio/wav' });
}

type RootTracks = { tracks: { tracks: Track[] } };

function addPeerBassSource(): void {
    mutateCrdtDoc<RootTracks>({
        id: 'root',
        message: 'Peer added a missing Bass.wav source',
        changeFn: (document) => {
            document.tracks.tracks.push(trackForClip(audioClip('clip-peer', 'track-peer', 'buf-peer', 'Bass.wav')));
        },
    });
    trackStore.hydrate({ keepLocalRuntimeState: true });
}

function expectOnlyInitialRepair(unrepairedSources: readonly string[]): void {
    const sources = ['decoded-first-replacement.wav', ...unrepairedSources];
    expect(getCrdtDoc<RootTracks>('root')?.tracks.tracks.map((track) => track.clips[0]?.audioBufferId)).toEqual(
        sources
    );
    expect(trackStore.value?.tracks.map((track) => track.clips[0]?.audioBufferId)).toEqual(sources);
    expect(undoHistoryStore.value?.past).toHaveLength(1);
}

describe('locateMissingMedia', () => {
    let releases: Array<ReturnType<typeof vi.fn<() => void>>>;
    afterEach(() => {
        for (const release of releases) {
            expect(release).toHaveBeenCalledTimes(1);
        }
        vi.restoreAllMocks();
        flushAutomergeStorageWrites();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });
    beforeEach(() => {
        releases = [];
        const subscribe = arrangementStore.subscribe;
        vi.spyOn(arrangementStore, 'subscribe').mockImplementation((listener) => {
            const release = vi.fn(subscribe(listener));
            releases.push(release);
            return release;
        });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Locate owning fixture');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        projectStore.set({ ...defaultProjectStoreState, loading: false });
        vi.clearAllMocks();
        mocks.buffers.clear();
        mocks.isCurrentProject.mockReturnValue(true);
        mocks.decodeAudioFile.mockImplementation(async (file: File) => {
            const id = `decoded-${file.name}`;
            mocks.buffers.set(id, {} as AudioBuffer);
            return { id, buffer: mocks.buffers.get(id)! };
        });
        arrange([
            audioClip('clip-left', 'track-one', 'buf-guitar', 'Guitar.wav'),
            audioClip('clip-right', 'track-two', 'buf-guitar', 'Guitar.wav'),
        ]);
        vi.mocked(confirmUser).mockResolvedValue(false);
        flushAutomergeStorageWrites();
    });

    it('uses the picker and shared-source relink, then clears every repaired reference', async () => {
        vi.mocked(pickFilesFromNativeDialog).mockResolvedValue([replacement('replacement.wav')]);

        await locateMissingMedia({ sourceBufferId: 'buf-guitar', label: 'Guitar.wav' });

        expect(pickFilesFromNativeDialog).toHaveBeenCalledExactlyOnceWith({
            filters: [{ name: 'Audio files', extensions: expect.arrayContaining(['wav', 'flac']) }],
            multiple: false,
        });
        expect(trackStore.value?.tracks.flatMap((track) => track.clips.map((clip) => clip.audioBufferId))).toEqual([
            'decoded-replacement.wav',
            'decoded-replacement.wav',
        ]);
        expect(missingMediaStore.value).toEqual(defaultMissingMediaStoreState);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.past[0]?.kind).toBe('action');
        expect(vi.mocked(clearClipPitchAnalysis).mock.calls.map((call) => call[0])).toEqual([
            'clip-left',
            'clip-right',
        ]);
    });

    it('leaves project and missing-media state untouched when the picker is cancelled', async () => {
        vi.mocked(pickFilesFromNativeDialog).mockResolvedValue(null);
        const tracksBefore = trackStore.value;
        const missingBefore = missingMediaStore.value;

        await locateMissingMedia({ sourceBufferId: 'buf-guitar', label: 'Guitar.wav' });

        expect(trackStore.value).toBe(tracksBefore);
        expect(missingMediaStore.value).toBe(missingBefore);
        expect(mocks.decodeAudioFile).not.toHaveBeenCalled();
    });

    it('rejects a non-audio replacement without decoding or changing state', async () => {
        vi.mocked(pickFilesFromNativeDialog).mockResolvedValue([new File(['text'], 'notes.txt')]);
        const tracksBefore = trackStore.value;
        const missingBefore = missingMediaStore.value;

        await locateMissingMedia({ sourceBufferId: 'buf-guitar', label: 'Guitar.wav' });

        expect(trackStore.value).toBe(tracksBefore);
        expect(missingMediaStore.value).toBe(missingBefore);
        expect(mocks.decodeAudioFile).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('not a supported audio file'), 'error');
    });

    it('reports decode failure and preserves the missing source', async () => {
        vi.mocked(pickFilesFromNativeDialog).mockResolvedValue([replacement('broken.wav')]);
        mocks.decodeAudioFile.mockRejectedValue(new Error('decode failed'));
        const tracksBefore = trackStore.value;
        const missingBefore = missingMediaStore.value;

        await locateMissingMedia({ sourceBufferId: 'buf-guitar', label: 'Guitar.wav' });

        expect(trackStore.value).toBe(tracksBefore);
        expect(missingMediaStore.value).toBe(missingBefore);
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('could not be decoded'), 'error');
    });

    it('does not decode a picker result after its project authority changes', async () => {
        vi.mocked(pickFilesFromNativeDialog).mockResolvedValue([replacement('stale.wav')]);
        mocks.isCurrentProject.mockReturnValue(false);
        const tracksBefore = trackStore.value;
        const missingBefore = missingMediaStore.value;

        await locateMissingMedia({ sourceBufferId: 'buf-guitar', label: 'Guitar.wav' });

        expect(trackStore.value).toBe(tracksBefore);
        expect(missingMediaStore.value).toBe(missingBefore);
        expect(mocks.decodeAudioFile).not.toHaveBeenCalled();
        expect(mocks.discardDecodedAudioFile).not.toHaveBeenCalled();
        expect(confirmUser).not.toHaveBeenCalled();
    });

    it('offers a second multi-file picker and repairs only unambiguous matching sources', async () => {
        arrange([
            audioClip('clip-guitar', 'track-one', 'buf-guitar', 'Guitar.wav'),
            audioClip('clip-bass', 'track-two', 'buf-bass', 'Bass.wav'),
        ]);
        vi.mocked(pickFilesFromNativeDialog)
            .mockResolvedValueOnce([replacement('guitar-replacement.wav')])
            .mockResolvedValueOnce([replacement('Bass.WAV'), replacement('unrelated.wav')]);
        vi.mocked(confirmUser).mockResolvedValue(true);

        await locateMissingMedia({ sourceBufferId: 'buf-guitar', label: 'Guitar.wav' });

        expect(confirmUser).toHaveBeenCalledOnce();
        expect(pickFilesFromNativeDialog).toHaveBeenNthCalledWith(2, {
            filters: [{ name: 'Audio files', extensions: expect.arrayContaining(['wav', 'flac']) }],
            multiple: true,
        });
        expect(trackStore.value?.tracks.flatMap((track) => track.clips.map((clip) => clip.audioBufferId))).toEqual([
            'decoded-guitar-replacement.wav',
            'decoded-Bass.WAV',
        ]);
        expect(mocks.decodeAudioFile).toHaveBeenCalledTimes(2);
        expect(missingMediaStore.value).toEqual(defaultMissingMediaStoreState);
    });

    it('does not offer a same-folder picker for a source owned by a frozen track', async () => {
        arrange([
            audioClip('clip-guitar', 'track-one', 'buf-guitar', 'Guitar.wav'),
            audioClip('clip-bass', 'track-two', 'buf-bass', 'Bass.wav'),
        ]);
        const state = trackStore.value!;
        trackStore.set({
            ...state,
            tracks: state.tracks.map((owner) => {
                if (owner.id !== 'track-two') {
                    return owner;
                }
                return { ...owner, frozen: true, freezeState: { status: 'frozen', frozenBufferId: 'rendered-bass' } };
            }),
        });
        flushAutomergeStorageWrites();
        mocks.buffers.set('rendered-bass', {} as AudioBuffer);
        vi.mocked(pickFilesFromNativeDialog).mockResolvedValue([replacement('guitar-replacement.wav')]);
        vi.mocked(confirmUser).mockResolvedValue(true);

        await locateMissingMedia({ sourceBufferId: 'buf-guitar', label: 'Guitar.wav' });

        expect(pickFilesFromNativeDialog).toHaveBeenCalledOnce();
        expect(confirmUser).not.toHaveBeenCalled();
        expect(mocks.decodeAudioFile).toHaveBeenCalledOnce();
        expect(trackStore.value?.tracks.map((owner) => owner.clips[0]?.audioBufferId)).toEqual([
            'decoded-guitar-replacement.wav',
            'buf-bass',
        ]);
        expect(missingMediaStore.value?.items).toEqual([
            expect.objectContaining({ bufferId: 'buf-bass', clipId: 'clip-bass' }),
        ]);
    });

    it('skips one missing source matched by two selected files and warns without relinking it', async () => {
        arrange([
            audioClip('clip-guitar', 'track-one', 'buf-guitar', 'Guitar.wav'),
            audioClip('clip-bass', 'track-two', 'buf-bass', 'Bass.wav'),
        ]);
        vi.mocked(pickFilesFromNativeDialog)
            .mockResolvedValueOnce([replacement('guitar-replacement.wav')])
            .mockResolvedValueOnce([replacement('Bass.WAV'), replacement('bass.wav')]);
        vi.mocked(confirmUser).mockResolvedValue(true);

        await locateMissingMedia({ sourceBufferId: 'buf-guitar', label: 'Guitar.wav' });

        expect(trackStore.value?.tracks.map((track) => track.clips[0]?.audioBufferId)).toEqual([
            'decoded-guitar-replacement.wav',
            'buf-bass',
        ]);
        expect(mocks.decodeAudioFile).toHaveBeenCalledTimes(1);
        expect(missingMediaStore.value?.items).toEqual([
            expect.objectContaining({ bufferId: 'buf-bass', clipId: 'clip-bass' }),
        ]);
        expect(notifyUser).toHaveBeenCalledWith(
            '2 selected files did not uniquely match a missing clip name and were left unchanged.',
            'warning'
        );
    });

    it('does not strip a dotted source label when its suffix is not an audio extension', async () => {
        arrange([
            audioClip('clip-guitar', 'track-one', 'buf-guitar', 'Guitar.wav'),
            audioClip('clip-mix', 'track-two', 'buf-mix', 'mix.v2'),
        ]);
        vi.mocked(pickFilesFromNativeDialog)
            .mockResolvedValueOnce([replacement('guitar-replacement.wav')])
            .mockResolvedValueOnce([replacement('mix.wav')]);
        vi.mocked(confirmUser).mockResolvedValue(true);

        await locateMissingMedia({ sourceBufferId: 'buf-guitar', label: 'Guitar.wav' });

        expect(trackStore.value?.tracks.map((track) => track.clips[0]?.audioBufferId)).toEqual([
            'decoded-guitar-replacement.wav',
            'buf-mix',
        ]);
        expect(mocks.decodeAudioFile).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledWith(
            '1 selected file did not uniquely match a missing clip name and was left unchanged.',
            'warning'
        );
    });

    it('matches a dotted source label to its audio filename', async () => {
        arrange([
            audioClip('clip-guitar', 'track-one', 'buf-guitar', 'Guitar.wav'),
            audioClip('clip-mix', 'track-two', 'buf-mix', 'mix.v2'),
        ]);
        vi.mocked(pickFilesFromNativeDialog)
            .mockResolvedValueOnce([replacement('guitar-replacement.wav')])
            .mockResolvedValueOnce([replacement('mix.v2.wav')]);
        vi.mocked(confirmUser).mockResolvedValue(true);

        await locateMissingMedia({ sourceBufferId: 'buf-guitar', label: 'Guitar.wav' });

        expect(trackStore.value?.tracks.map((track) => track.clips[0]?.audioBufferId)).toEqual([
            'decoded-guitar-replacement.wav',
            'decoded-mix.v2.wav',
        ]);
        expect(mocks.decodeAudioFile).toHaveBeenCalledTimes(2);
        expect(missingMediaStore.value).toEqual(defaultMissingMediaStoreState);
    });

    it('leaves two missing sources with the same normalized name unchanged', async () => {
        arrange([
            audioClip('clip-guitar', 'track-one', 'buf-guitar', 'Guitar.wav'),
            audioClip('clip-bass-one', 'track-two', 'buf-bass-one', 'Bass.wav'),
            audioClip('clip-bass-two', 'track-three', 'buf-bass-two', 'Bass.wav'),
        ]);
        vi.mocked(pickFilesFromNativeDialog)
            .mockResolvedValueOnce([replacement('guitar-replacement.wav')])
            .mockResolvedValueOnce([replacement('Bass.wav')]);
        vi.mocked(confirmUser).mockResolvedValue(true);

        await locateMissingMedia({ sourceBufferId: 'buf-guitar', label: 'Guitar.wav' });

        expect(trackStore.value?.tracks.map((track) => track.clips[0]?.audioBufferId)).toEqual([
            'decoded-guitar-replacement.wav',
            'buf-bass-one',
            'buf-bass-two',
        ]);
        expect(mocks.decodeAudioFile).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledWith(
            '1 selected file did not uniquely match a missing clip name and was left unchanged.',
            'warning'
        );
    });

    it.each([
        { firstAlias: 'Guitar.wav', secondAlias: 'Bass.wav' },
        { firstAlias: 'Bass.wav', secondAlias: 'Guitar.wav' },
    ])('skips a name shared by two sources with $firstAlias listed first', async ({ firstAlias, secondAlias }) => {
        arrange([
            audioClip('clip-first', 'track-first', 'buf-first', 'First.wav'),
            audioClip('clip-a1', 'track-a1', 'buf-a', firstAlias),
            audioClip('clip-a2', 'track-a2', 'buf-a', secondAlias),
            audioClip('clip-b', 'track-b', 'buf-b', 'Bass.wav'),
        ]);
        const firstFile = replacement('first-replacement.wav');
        vi.mocked(pickFilesFromNativeDialog)
            .mockResolvedValueOnce([firstFile])
            .mockResolvedValueOnce([replacement('Bass.wav')]);
        vi.mocked(confirmUser).mockResolvedValue(true);

        await locateMissingMedia({ sourceBufferId: 'buf-first', label: 'First.wav' });

        expect(trackStore.value?.tracks.map((track) => track.clips[0]?.audioBufferId)).toEqual([
            'decoded-first-replacement.wav',
            'buf-a',
            'buf-a',
            'buf-b',
        ]);
        expect(mocks.decodeAudioFile).toHaveBeenCalledExactlyOnceWith(firstFile);
        expect(notifyUser).toHaveBeenCalledWith(
            '1 selected file did not uniquely match a missing clip name and was left unchanged.',
            'warning'
        );
    });

    it('repairs a source through a name repeated by its own aliases', async () => {
        arrange([
            audioClip('clip-first', 'track-first', 'buf-first', 'First.wav'),
            audioClip('clip-a1', 'track-a1', 'buf-a', 'Guitar.wav'),
            audioClip('clip-a2', 'track-a2', 'buf-a', 'Bass.wav'),
            audioClip('clip-a3', 'track-a3', 'buf-a', 'BASS.WAV'),
        ]);
        const bassFile = replacement('Bass.wav');
        vi.mocked(pickFilesFromNativeDialog)
            .mockResolvedValueOnce([replacement('first-replacement.wav')])
            .mockResolvedValueOnce([bassFile]);
        vi.mocked(confirmUser).mockResolvedValue(true);

        await locateMissingMedia({ sourceBufferId: 'buf-first', label: 'First.wav' });

        expect(trackStore.value?.tracks.map((track) => track.clips[0]?.audioBufferId)).toEqual([
            'decoded-first-replacement.wav',
            'decoded-Bass.wav',
            'decoded-Bass.wav',
            'decoded-Bass.wav',
        ]);
        expect(mocks.decodeAudioFile).toHaveBeenCalledTimes(2);
        expect(mocks.decodeAudioFile).toHaveBeenNthCalledWith(2, bassFile);
        expect(missingMediaStore.value).toEqual(defaultMissingMediaStoreState);
    });

    it.each([
        { firstSelection: 'Guitar.wav', secondSelection: 'Bass.wav' },
        { firstSelection: 'Bass.wav', secondSelection: 'Guitar.wav' },
    ])(
        'skips two selected alias names for one source when $firstSelection is selected first',
        async ({ firstSelection, secondSelection }) => {
            arrange([
                audioClip('clip-first', 'track-first', 'buf-first', 'First.wav'),
                audioClip('clip-a1', 'track-a1', 'buf-a', 'Guitar.wav'),
                audioClip('clip-a2', 'track-a2', 'buf-a', 'Bass.wav'),
            ]);
            const firstFile = replacement('first-replacement.wav');
            vi.mocked(pickFilesFromNativeDialog)
                .mockResolvedValueOnce([firstFile])
                .mockResolvedValueOnce([replacement(firstSelection), replacement(secondSelection)]);
            vi.mocked(confirmUser).mockResolvedValue(true);

            await locateMissingMedia({ sourceBufferId: 'buf-first', label: 'First.wav' });

            expect(trackStore.value?.tracks.map((track) => track.clips[0]?.audioBufferId)).toEqual([
                'decoded-first-replacement.wav',
                'buf-a',
                'buf-a',
            ]);
            expect(mocks.decodeAudioFile).toHaveBeenCalledExactlyOnceWith(firstFile);
            expect(notifyUser).toHaveBeenCalledWith(
                '2 selected files did not uniquely match a missing clip name and were left unchanged.',
                'warning'
            );
        }
    );

    it.each(['frozen', 'locked'] as const)(
        'skips a same-folder name shared by an editable and a %s source',
        async (blockedBy) => {
            arrange([
                audioClip('clip-first', 'track-first', 'buf-first', 'First.wav'),
                audioClip('clip-editable', 'track-editable', 'buf-editable', 'Bass.wav'),
                audioClip('clip-blocked', 'track-blocked', 'buf-blocked', 'Bass.wav'),
            ]);
            mutateCrdtDoc<RootTracks>({
                id: 'root',
                changeFn: (document) => {
                    const owner = document.tracks.tracks[2]!;
                    if (blockedBy === 'frozen') {
                        owner.frozen = true;
                        owner.freezeState = { status: 'frozen', frozenBufferId: 'rendered-bass' };
                    } else {
                        owner.clips[0]!.locked = true;
                    }
                },
            });
            trackStore.hydrate({ keepLocalRuntimeState: true });
            mocks.buffers.set('rendered-bass', {} as AudioBuffer);
            const firstFile = replacement('first-replacement.wav');
            vi.mocked(pickFilesFromNativeDialog)
                .mockResolvedValueOnce([firstFile])
                .mockResolvedValueOnce([replacement('Bass.wav')]);
            vi.mocked(confirmUser).mockResolvedValue(true);

            await locateMissingMedia({ sourceBufferId: 'buf-first', label: 'First.wav' });

            expect(pickFilesFromNativeDialog).toHaveBeenCalledTimes(2);
            expectOnlyInitialRepair(['buf-editable', 'buf-blocked']);
            expect(mocks.decodeAudioFile).toHaveBeenCalledExactlyOnceWith(firstFile);
        }
    );

    it('skips a same-folder name which becomes ambiguous while the picker is open', async () => {
        arrange([
            audioClip('clip-first', 'track-first', 'buf-first', 'First.wav'),
            audioClip('clip-bass', 'track-bass', 'buf-bass', 'Bass.wav'),
        ]);
        const firstFile = replacement('first-replacement.wav');
        const opened = Promise.withResolvers<void>();
        const selection = Promise.withResolvers<File[] | null>();
        vi.mocked(pickFilesFromNativeDialog)
            .mockResolvedValueOnce([firstFile])
            .mockImplementationOnce(() => {
                opened.resolve();
                return selection.promise;
            });
        vi.mocked(confirmUser).mockResolvedValue(true);

        const locating = locateMissingMedia({ sourceBufferId: 'buf-first', label: 'First.wav' });
        await opened.promise;
        addPeerBassSource();
        verifyAudioBufferReferences();
        expect(missingMediaStore.value?.items.map((item) => item.bufferId)).toEqual(['buf-bass', 'buf-peer']);
        selection.resolve([replacement('Bass.wav')]);
        await locating;

        expectOnlyInitialRepair(['buf-bass', 'buf-peer']);
        expect(mocks.decodeAudioFile).toHaveBeenCalledExactlyOnceWith(firstFile);
    });

    it('discards the same-folder decode when its name becomes ambiguous during decoding', async () => {
        arrange([
            audioClip('clip-first', 'track-first', 'buf-first', 'First.wav'),
            audioClip('clip-bass', 'track-bass', 'buf-bass', 'Bass.wav'),
        ]);
        const bassFile = replacement('Bass.wav');
        vi.mocked(pickFilesFromNativeDialog)
            .mockResolvedValueOnce([replacement('first-replacement.wav')])
            .mockResolvedValueOnce([bassFile]);
        vi.mocked(confirmUser).mockResolvedValue(true);
        const decoding = Promise.withResolvers<File>();
        const decoded = Promise.withResolvers<{ id: string; buffer: AudioBuffer }>();
        mocks.decodeAudioFile
            .mockImplementationOnce(mocks.decodeAudioFile.getMockImplementation()!)
            .mockImplementationOnce((file: File) => {
                decoding.resolve(file);
                return decoded.promise;
            });
        mocks.discardDecodedAudioFile.mockImplementationOnce((id: string) => mocks.buffers.delete(id));

        const locating = locateMissingMedia({ sourceBufferId: 'buf-first', label: 'First.wav' });
        expect(await decoding.promise).toBe(bassFile);
        addPeerBassSource();
        const buffer = {} as AudioBuffer;
        const id = 'decoded-Bass.wav';
        mocks.buffers.set(id, buffer);
        decoded.resolve({ id, buffer });
        await locating;

        expectOnlyInitialRepair(['buf-bass', 'buf-peer']);
        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledExactlyOnceWith(id);
        expect(mocks.buffers.has(id)).toBe(false);
    });

    it('refuses a same-folder relink when its name becomes ambiguous after command staging', async () => {
        arrange([
            audioClip('clip-first', 'track-first', 'buf-first', 'First.wav'),
            audioClip('clip-bass', 'track-bass', 'buf-bass', 'Bass.wav'),
        ]);
        vi.mocked(pickFilesFromNativeDialog)
            .mockResolvedValueOnce([replacement('first-replacement.wav')])
            .mockResolvedValueOnce([replacement('Bass.wav')]);
        vi.mocked(confirmUser).mockResolvedValue(true);
        const handler = getArrangementHandlers().relinkClipAudioSources;
        const execute = handler.execute;
        vi.spyOn(handler, 'execute').mockImplementation(async (action, context) => {
            const result = await execute(action, context);
            if (action.payload.targets[0]?.before.audioBufferId === 'buf-bass') {
                expect(trackStore.value?.tracks[1]?.clips[0]?.audioBufferId).toBe('decoded-Bass.wav');
                addPeerBassSource();
            }
            return result;
        });

        await locateMissingMedia({ sourceBufferId: 'buf-first', label: 'First.wav' });

        expect(handler.execute).toHaveBeenCalledTimes(2);
        expectOnlyInitialRepair(['buf-bass', 'buf-peer']);
        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledExactlyOnceWith('decoded-Bass.wav');
    });
});
