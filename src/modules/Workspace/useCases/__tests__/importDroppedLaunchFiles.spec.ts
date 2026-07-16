import { beforeEach, describe, expect, it, vi } from 'vitest';

import { importDroppedLaunchFiles } from '../importDroppedLaunchFiles';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
};

type ImportMidiFileMock = (
    file: File,
    options?: { shouldContinue?: () => boolean }
) => Promise<'completed' | 'superseded'>;

function createDeferred<T>(): Deferred<T> {
    let resolveDeferred!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
        resolveDeferred = resolve;
    });

    return { promise, resolve: resolveDeferred };
}

const mocks = vi.hoisted(() => ({
    addClip: vi.fn(),
    addTrack: vi.fn(),
    cacheAudioBuffer: vi.fn(),
    decodeAudioFileBuffer: vi.fn(),
    getTransportState: vi.fn<() => { tempo: number } | null>(() => ({ tempo: 120 })),
    importMidiFile: vi.fn<ImportMidiFileMock>(),
    isProjectTransitionCurrent: vi.fn(),
    newProject: vi.fn(),
    removeTrack: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addClip: mocks.addClip,
    addTrack: mocks.addTrack,
    importMidiFile: mocks.importMidiFile,
    removeTrack: mocks.removeTrack,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: mocks.cacheAudioBuffer,
    decodeAudioFileBuffer: mocks.decodeAudioFileBuffer,
}));

vi.mock('#/modules/Project/useCases', () => ({
    captureProjectTransitionAuthority: () => ({ isCurrent: mocks.isProjectTransitionCurrent }),
    newProject: mocks.newProject,
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return mocks.getTransportState();
        },
    },
}));

function expectMidiImportWithAuthority(file: File): void {
    const call = mocks.importMidiFile.mock.calls[0];
    expect(call?.[0]).toBe(file);
    expect(call?.[1]?.shouldContinue?.()).toBe(true);
}

describe('importDroppedLaunchFiles', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.addClip.mockReturnValue({ id: 'clip-1' });
        mocks.addTrack.mockReturnValue({ id: 'track-1' });
        mocks.decodeAudioFileBuffer.mockResolvedValue({ duration: 4 });
        mocks.getTransportState.mockReturnValue({ tempo: 90 });
        mocks.importMidiFile.mockResolvedValue('completed');
        mocks.isProjectTransitionCurrent.mockReturnValue(true);
        mocks.newProject.mockResolvedValue(true);
    });

    it('resets the project and imports supported files by extension', async () => {
        const midiFile = new File(['midi'], 'melody.MID', { type: 'application/octet-stream' });
        const audioFile = new File(['audio'], 'drums.AIFF', { type: 'application/octet-stream' });
        const unsupportedFile = new File(['notes'], 'notes.txt', { type: 'text/plain' });

        const result = await importDroppedLaunchFiles({ files: [midiFile, audioFile, unsupportedFile] });

        expect(mocks.newProject).toHaveBeenCalledTimes(1);
        expect(mocks.importMidiFile).toHaveBeenCalledTimes(1);
        expectMidiImportWithAuthority(midiFile);
        expect(mocks.addTrack).toHaveBeenCalledTimes(1);
        expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'drums', kind: 'audio' });
        expect(mocks.decodeAudioFileBuffer).toHaveBeenCalledTimes(1);
        expect(mocks.decodeAudioFileBuffer).toHaveBeenCalledWith(audioFile);
        expect(mocks.decodeAudioFileBuffer.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.addTrack.mock.invocationCallOrder[0]!
        );
        expect(mocks.addClip).toHaveBeenCalledWith({
            trackId: 'track-1',
            startBeat: 0,
            endBeat: 6,
            name: 'drums',
            type: 'audio',
            audioBufferId: expect.stringMatching(/^audio-/),
        });
        expect(mocks.cacheAudioBuffer).toHaveBeenCalledWith({
            buffer: { duration: 4 },
            bufferId: expect.stringMatching(/^audio-/),
        });
        expect(result).toEqual({ status: 'completed', failedFileNames: [] });
    });

    it('does not activate a project when no dropped files are supported', async () => {
        const unsupportedFile = new File(['notes'], 'notes.txt', { type: 'text/plain' });

        const result = await importDroppedLaunchFiles({ files: [unsupportedFile] });

        expect(mocks.newProject).not.toHaveBeenCalled();
        expect(mocks.importMidiFile).not.toHaveBeenCalled();
        expect(mocks.decodeAudioFileBuffer).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'unsupported' });
    });

    it('waits for new-project activation before importing any files', async () => {
        const activation = createDeferred<boolean>();
        const midiFile = new File(['midi'], 'melody.mid', { type: 'audio/midi' });
        const audioFile = new File(['audio'], 'drums.wav', { type: 'audio/wav' });
        mocks.newProject.mockReturnValue(activation.promise);

        const importPromise = importDroppedLaunchFiles({ files: [midiFile, audioFile] });
        await Promise.resolve();

        expect(mocks.importMidiFile).not.toHaveBeenCalled();
        expect(mocks.decodeAudioFileBuffer).not.toHaveBeenCalled();
        expect(mocks.addTrack).not.toHaveBeenCalled();

        activation.resolve(true);
        const result = await importPromise;

        expectMidiImportWithAuthority(midiFile);
        expect(mocks.decodeAudioFileBuffer).toHaveBeenCalledWith(audioFile);
        expect(result).toEqual({ status: 'completed', failedFileNames: [] });
    });

    it('does not import files when new-project activation is not committed', async () => {
        const audioFile = new File(['audio'], 'drums.wav', { type: 'audio/wav' });
        mocks.newProject.mockResolvedValue(false);

        const result = await importDroppedLaunchFiles({ files: [audioFile] });

        expect(mocks.decodeAudioFileBuffer).not.toHaveBeenCalled();
        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'activation-failed' });
    });

    it('classifies supported MIME types and applies the default tempo and minimum duration', async () => {
        const midiFile = new File(['midi'], 'sequence.bin', { type: 'audio/midi' });
        const audioFile = new File(['audio'], 'voice.bin', { type: 'audio/webm' });
        mocks.getTransportState.mockReturnValue(null);
        mocks.decodeAudioFileBuffer.mockResolvedValue({ duration: 1 });

        const result = await importDroppedLaunchFiles({ files: [midiFile, audioFile] });

        expectMidiImportWithAuthority(midiFile);
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                endBeat: 4,
                audioBufferId: expect.stringMatching(/^audio-/),
            })
        );
        expect(result).toEqual({ status: 'completed', failedFileNames: [] });
    });

    it('silently skips clip creation when a track cannot be created', async () => {
        const audioFile = new File(['audio'], 'orphan.wav', { type: 'audio/wav' });
        mocks.addTrack.mockReturnValue(null);

        const result = await importDroppedLaunchFiles({ files: [audioFile] });

        expect(mocks.decodeAudioFileBuffer).toHaveBeenCalledWith(audioFile);
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'completed', failedFileNames: [] });
    });

    it('rolls back a created track when clip creation cannot complete', async () => {
        const audioFile = new File(['audio'], 'orphan.wav', { type: 'audio/wav' });
        mocks.addClip.mockReturnValue(null);

        const result = await importDroppedLaunchFiles({ files: [audioFile] });

        expect(mocks.removeTrack).toHaveBeenCalledWith('track-1');
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'completed', failedFileNames: [] });
    });

    it('does not commit a deferred decode after a second project transition starts', async () => {
        const audioFile = new File(['audio'], 'slow.wav', { type: 'audio/wav' });
        const decode = createDeferred<{ duration: number }>();
        mocks.decodeAudioFileBuffer.mockReturnValue(decode.promise);

        const importPromise = importDroppedLaunchFiles({ files: [audioFile] });
        await vi.waitFor(() => expect(mocks.decodeAudioFileBuffer).toHaveBeenCalledWith(audioFile));

        mocks.isProjectTransitionCurrent.mockReturnValue(false);
        decode.resolve({ duration: 4 });

        await expect(importPromise).resolves.toEqual({ status: 'superseded' });
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    it('returns superseded when the owning MIDI import loses project authority', async () => {
        const midiFile = new File(['midi'], 'slow.mid', { type: 'audio/midi' });
        const midiImport = createDeferred<'completed' | 'superseded'>();
        mocks.importMidiFile.mockReturnValue(midiImport.promise);

        const importPromise = importDroppedLaunchFiles({ files: [midiFile] });
        await vi.waitFor(() => expect(mocks.importMidiFile).toHaveBeenCalledTimes(1));
        expectMidiImportWithAuthority(midiFile);

        mocks.isProjectTransitionCurrent.mockReturnValue(false);
        midiImport.resolve('superseded');

        await expect(importPromise).resolves.toEqual({ status: 'superseded' });
    });

    it('removes a partial track if project authority changes during the audio commit', async () => {
        const audioFile = new File(['audio'], 'interrupted.wav', { type: 'audio/wav' });
        mocks.isProjectTransitionCurrent.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);

        const result = await importDroppedLaunchFiles({ files: [audioFile] });

        expect(result).toEqual({ status: 'superseded' });
        expect(mocks.removeTrack).toHaveBeenCalledWith('track-1');
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
    });

    it('returns audio import failures and continues importing later files', async () => {
        const failedFile = new File(['bad'], 'broken.wav', { type: 'audio/wav' });
        const importedFile = new File(['good'], 'working.wav', { type: 'audio/wav' });
        mocks.addTrack.mockReturnValue({ id: 'track-good' });
        mocks.decodeAudioFileBuffer
            .mockRejectedValueOnce(new Error('decode failed'))
            .mockResolvedValueOnce({ duration: 4 });

        const result = await importDroppedLaunchFiles({ files: [failedFile, importedFile] });

        expect(result).toEqual({ status: 'completed', failedFileNames: ['broken.wav'] });
        expect(mocks.decodeAudioFileBuffer).toHaveBeenCalledWith(importedFile);
        expect(mocks.addTrack).toHaveBeenCalledTimes(1);
        expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'working', kind: 'audio' });
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                trackId: 'track-good',
                name: 'working',
                audioBufferId: expect.stringMatching(/^audio-/),
            })
        );
    });
});
