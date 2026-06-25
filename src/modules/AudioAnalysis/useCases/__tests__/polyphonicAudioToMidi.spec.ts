import { describe, it, expect, vi, beforeEach } from 'vitest';

import { polyphonicAudioToMidi } from '../polyphonicAudioToMidi';

const getAllTracksMock = vi.fn(() => [] as unknown[]);

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: () => getAllTracksMock(),
}));

const audioBufferCacheGet = vi.fn<(id: string) => AudioBuffer | undefined>();
vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: {
        get: (id: string) => audioBufferCacheGet(id),
    },
}));

const loggerWarnMock = vi.fn<(message: string) => void>();
vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        warn: (message: string) => loggerWarnMock(message),
        info: vi.fn(),
        error: vi.fn(),
    },
}));

// Count BasicPitch constructions so we can prove concurrent callers share a
// single model load instead of each building their own (the OOM/duplicate-
// load hazard the in-flight-promise memoization guards against).
const basicPitchCtor = vi.fn<(modelPath: string) => void>();
vi.mock('@spotify/basic-pitch', () => ({
    BasicPitch: class {
        constructor(modelPath: string) {
            basicPitchCtor(modelPath);
        }
        // No notes detected — keeps the use case's later stages trivial.
        evaluateModel(
            _buffer: unknown,
            onComplete: (f: number[][], o: number[][], c: number[][]) => void,
            _onProgress: (p: number) => void
        ): Promise<void> {
            onComplete([], [], []);
            return Promise.resolve();
        }
    },
    outputToNotesPoly: vi.fn(() => []),
    addPitchBendsToNoteEvents: vi.fn((_c: unknown, notes: unknown) => notes),
    noteFramesToTime: vi.fn(() => []),
}));

vi.mock('@spotify/basic-pitch/model/model.json?url', () => ({ default: 'mock-model-url' }));

describe('polyphonicAudioToMidi', () => {
    beforeEach(() => {
        getAllTracksMock.mockReset();
        getAllTracksMock.mockReturnValue([]);
        audioBufferCacheGet.mockReset();
        loggerWarnMock.mockReset();
        basicPitchCtor.mockReset();
    });

    it('should return null and warn when clip is not found', async () => {
        const result = await polyphonicAudioToMidi({ clipId: 'missing-clip' });

        expect(result).toBeNull();
        expect(loggerWarnMock).toHaveBeenCalledWith(expect.stringContaining('Clip not found'));
    });

    it('constructs the Basic Pitch model only once across concurrent first calls', async () => {
        const clip = {
            id: 'clip-1',
            audioBufferId: 'buf-1',
            name: 'Take 1',
            startBeat: 0,
            endBeat: 4,
        };
        getAllTracksMock.mockReturnValue([{ clips: [clip] }]);
        audioBufferCacheGet.mockReturnValue({
            sampleRate: 22050,
            length: 22050,
            duration: 1,
            numberOfChannels: 1,
        } as unknown as AudioBuffer);

        // Two callers race before either finishes loading the model. The
        // memoized load promise must coalesce them onto a single BasicPitch.
        await Promise.all([polyphonicAudioToMidi({ clipId: 'clip-1' }), polyphonicAudioToMidi({ clipId: 'clip-1' })]);

        expect(basicPitchCtor).toHaveBeenCalledTimes(1);
    });
});
