import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Clip, type Track, trackStore } from '#/modules/Arrangement/stores';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { clearClipPitchAnalysis } from '#/modules/Knead/useCases';
import { confirmUser } from '#/utils/Notification/confirmUser';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { pickFiles as pickFilesFromNativeDialog } from '../../repositories/nativeFileDialog/pickFiles';
import { defaultMissingMediaStoreState, missingMediaStore } from '../../stores/missingMediaStore';
import { locateMissingMedia } from '../locateMissingMedia';

const mocks = vi.hoisted(() => ({
    buffers: new Map<string, AudioBuffer>(),
    decodeAudioFile: vi.fn(),
    discardDecodedAudioFile: vi.fn(),
    isCurrentProject: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    decodeAudioFile: mocks.decodeAudioFile,
    discardDecodedAudioFile: mocks.discardDecodedAudioFile,
    getCachedAudioBuffer: ({ bufferId }: { bufferId: string }) => mocks.buffers.get(bufferId) ?? null,
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    pushUndoEntry: vi.fn(),
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
}

function replacement(name: string): File {
    return new File([new Uint8Array(8)], name, { type: 'audio/wav' });
}

describe('locateMissingMedia', () => {
    beforeEach(() => {
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
        expect(pushUndoEntry).toHaveBeenCalledTimes(1);
        expect(pushUndoEntry).toHaveBeenCalledWith('Relink audio source', expect.any(Function), expect.any(Function), {
            restoresBufferIds: ['decoded-replacement.wav'],
        });
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

    it('discards a decoded replacement when the project changes during the picker flow', async () => {
        vi.mocked(pickFilesFromNativeDialog).mockResolvedValue([replacement('stale.wav')]);
        mocks.isCurrentProject.mockReturnValue(false);
        const tracksBefore = trackStore.value;
        const missingBefore = missingMediaStore.value;

        await locateMissingMedia({ sourceBufferId: 'buf-guitar', label: 'Guitar.wav' });

        expect(trackStore.value).toBe(tracksBefore);
        expect(missingMediaStore.value).toBe(missingBefore);
        expect(mocks.discardDecodedAudioFile).toHaveBeenCalledExactlyOnceWith('decoded-stale.wav');
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
});
