import { beforeEach, describe, expect, it, vi } from 'vitest';

import { importDroppedLaunchFiles } from '../importDroppedLaunchFiles';

const mocks = vi.hoisted(() => ({
    addClip: vi.fn(),
    addTrack: vi.fn(),
    decodeAudioFile: vi.fn(),
    getTransportState: vi.fn<() => { tempo: number } | null>(() => ({ tempo: 120 })),
    importMidiFile: vi.fn(),
    newProject: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addClip: mocks.addClip,
    addTrack: mocks.addTrack,
    importMidiFile: mocks.importMidiFile,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    decodeAudioFile: mocks.decodeAudioFile,
}));

vi.mock('#/modules/Project/useCases', () => ({
    newProject: mocks.newProject,
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return mocks.getTransportState();
        },
    },
}));

describe('importDroppedLaunchFiles', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.addTrack.mockReturnValue({ id: 'track-1' });
        mocks.decodeAudioFile.mockResolvedValue({
            id: 'buffer-1',
            buffer: { duration: 4 },
        });
        mocks.getTransportState.mockReturnValue({ tempo: 90 });
    });

    it('resets the project and imports supported files by extension', async () => {
        const midiFile = new File(['midi'], 'melody.MID', { type: 'application/octet-stream' });
        const audioFile = new File(['audio'], 'drums.AIFF', { type: 'application/octet-stream' });
        const unsupportedFile = new File(['notes'], 'notes.txt', { type: 'text/plain' });

        const result = await importDroppedLaunchFiles({ files: [midiFile, audioFile, unsupportedFile] });

        expect(mocks.newProject).toHaveBeenCalledTimes(1);
        expect(mocks.importMidiFile).toHaveBeenCalledTimes(1);
        expect(mocks.importMidiFile).toHaveBeenCalledWith(midiFile);
        expect(mocks.addTrack).toHaveBeenCalledTimes(1);
        expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'drums', kind: 'audio' });
        expect(mocks.decodeAudioFile).toHaveBeenCalledTimes(1);
        expect(mocks.decodeAudioFile).toHaveBeenCalledWith(audioFile);
        expect(mocks.addClip).toHaveBeenCalledWith({
            trackId: 'track-1',
            startBeat: 0,
            endBeat: 6,
            name: 'drums',
            type: 'audio',
            audioBufferId: 'buffer-1',
        });
        expect(result).toEqual({ failedFileNames: [] });
    });

    it('classifies supported MIME types and applies the default tempo and minimum duration', async () => {
        const midiFile = new File(['midi'], 'sequence.bin', { type: 'audio/midi' });
        const audioFile = new File(['audio'], 'voice.bin', { type: 'audio/webm' });
        mocks.getTransportState.mockReturnValue(null);
        mocks.decodeAudioFile.mockResolvedValue({
            id: 'buffer-2',
            buffer: { duration: 1 },
        });

        const result = await importDroppedLaunchFiles({ files: [midiFile, audioFile] });

        expect(mocks.importMidiFile).toHaveBeenCalledWith(midiFile);
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                endBeat: 4,
                audioBufferId: 'buffer-2',
            })
        );
        expect(result).toEqual({ failedFileNames: [] });
    });

    it('silently skips audio files when a track cannot be created', async () => {
        const audioFile = new File(['audio'], 'orphan.wav', { type: 'audio/wav' });
        mocks.addTrack.mockReturnValue(null);

        const result = await importDroppedLaunchFiles({ files: [audioFile] });

        expect(mocks.decodeAudioFile).not.toHaveBeenCalled();
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(result).toEqual({ failedFileNames: [] });
    });

    it('returns audio import failures and continues importing later files', async () => {
        const failedFile = new File(['bad'], 'broken.wav', { type: 'audio/wav' });
        const importedFile = new File(['good'], 'working.wav', { type: 'audio/wav' });
        mocks.addTrack.mockReturnValueOnce({ id: 'track-bad' }).mockReturnValueOnce({ id: 'track-good' });
        mocks.decodeAudioFile
            .mockRejectedValueOnce(new Error('decode failed'))
            .mockResolvedValueOnce({ id: 'buffer-good', buffer: { duration: 4 } });

        const result = await importDroppedLaunchFiles({ files: [failedFile, importedFile] });

        expect(result).toEqual({ failedFileNames: ['broken.wav'] });
        expect(mocks.decodeAudioFile).toHaveBeenCalledWith(importedFile);
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                trackId: 'track-good',
                name: 'working',
                audioBufferId: 'buffer-good',
            })
        );
    });
});
