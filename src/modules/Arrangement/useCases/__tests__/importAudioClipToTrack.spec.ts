import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as subject from '../importAudioClipToTrack';

const mocks = vi.hoisted(() => {
    // `value` is deliberately nullable: one test drives it to undefined to
    // exercise the missing-transport branch.
    const transport: { value: { tempo: number } | undefined } = { value: { tempo: 120 } };
    return {
        decodeAudioFile: vi.fn<(file: File) => Promise<{ id: string; buffer: AudioBuffer }>>(),
        notifyUser: vi.fn(),
        getTrackById: vi.fn<(id: string) => { clips: { id: string; endBeat: number }[] } | undefined>(),
        addClip: vi.fn(),
        transport,
    };
});

vi.mock('#/modules/AudioEngine/useCases', () => ({
    decodeAudioFile: (file: File) => mocks.decodeAudioFile(file),
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return mocks.transport.value;
        },
    },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('../../repositories/track/getTrackById', () => ({
    getTrackById: (id: string) => mocks.getTrackById(id),
}));

vi.mock('../clip/addClip', () => ({
    addClip: mocks.addClip,
}));

function fakeBuffer(duration: number): AudioBuffer {
    return { duration } as unknown as AudioBuffer;
}

describe('importAudioClipToTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.transport.value = { tempo: 120 };
    });

    it('appends an audio clip after the last clip end, sized to the buffer duration', async () => {
        mocks.decodeAudioFile.mockResolvedValue({ id: 'buf-1', buffer: fakeBuffer(4) });
        mocks.getTrackById.mockReturnValue({
            clips: [
                { id: 'c1', endBeat: 8 },
                { id: 'c2', endBeat: 2 },
            ],
        });

        await subject.importAudioClipToTrack('t1', new File([], 'loop.wav'));

        expect(mocks.addClip).toHaveBeenCalledTimes(1);
        const input = mocks.addClip.mock.calls[0]?.[0] as {
            trackId: string;
            startBeat: number;
            endBeat: number;
            name: string;
            type: string;
            audioBufferId: string;
        };
        // 4s buffer at 120 BPM => 8 beats; starts after the latest clip end (8).
        expect(input).toMatchObject({
            trackId: 't1',
            startBeat: 8,
            endBeat: 16,
            name: 'loop',
            type: 'audio',
            audioBufferId: 'buf-1',
        });
    });

    it('starts the clip at beat 0 when the track has no existing clips', async () => {
        mocks.decodeAudioFile.mockResolvedValue({ id: 'buf-1', buffer: fakeBuffer(2) });
        mocks.getTrackById.mockReturnValue({ clips: [] });

        await subject.importAudioClipToTrack('t1', new File([], 'kick.mp3'));

        const input = mocks.addClip.mock.calls[0]?.[0] as { startBeat: number; endBeat: number; name: string };
        // 2s at 120 BPM => ceil(4) = 4 beats.
        expect(input.startBeat).toBe(0);
        expect(input.endBeat).toBe(4);
        // Strips the file extension for the clip name.
        expect(input.name).toBe('kick');
    });

    it('derives duration from the transport tempo when present', async () => {
        mocks.transport.value = { tempo: 60 };
        mocks.decodeAudioFile.mockResolvedValue({ id: 'buf-1', buffer: fakeBuffer(4) });
        mocks.getTrackById.mockReturnValue({ clips: [] });

        await subject.importAudioClipToTrack('t1', new File([], 'a.wav'));

        // 4s at 60 BPM => ceil(4) = 4 beats.
        const input = mocks.addClip.mock.calls[0]?.[0] as { endBeat: number };
        expect(input.endBeat).toBe(4);
    });

    it('notifies and aborts when the file cannot be decoded', async () => {
        mocks.decodeAudioFile.mockRejectedValue(new Error('bad'));

        await subject.importAudioClipToTrack('t1', new File([], 'corrupt.wav'));

        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('corrupt.wav'), 'error');
        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    it('aborts when the target track does not exist', async () => {
        mocks.decodeAudioFile.mockResolvedValue({ id: 'buf-1', buffer: fakeBuffer(4) });
        mocks.getTrackById.mockReturnValue(undefined);

        await subject.importAudioClipToTrack('ghost', new File([], 'a.wav'));

        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    it('falls back to 120 BPM when transport has no tempo', async () => {
        mocks.transport.value = undefined;
        mocks.decodeAudioFile.mockResolvedValue({ id: 'buf-1', buffer: fakeBuffer(4) });
        mocks.getTrackById.mockReturnValue({ clips: [] });

        await subject.importAudioClipToTrack('t1', new File([], 'a.wav'));

        const input = mocks.addClip.mock.calls[0]?.[0] as { endBeat: number };
        // 4s at default 120 BPM => 8 beats.
        expect(input.endBeat).toBe(8);
    });
});
