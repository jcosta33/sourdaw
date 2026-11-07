import { noteFramesToTime } from '@spotify/basic-pitch';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { polyphonicAudioToMidi } from '../polyphonicAudioToMidi';

const releaseGate = vi.hoisted(() => ({ basicPitch: true }));
const sourceAuthority = vi.hoisted(() => ({ revision: 'source-revision' }));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    settlePendingProjectWritesAndCaptureRevision: () => sourceAuthority.revision,
    projectRevisionMatchesLiveIgnoringSaveWrites: (revision: string) => revision === sourceAuthority.revision,
}));
const evaluate = vi.fn<() => Promise<void>>();

vi.mock('#/infra/release/modelReleaseAdmission', () => ({ MODEL_RELEASE_ADMISSION: releaseGate }));

const getAllTracksMock = vi.fn(() => [] as unknown[]);

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: () => getAllTracksMock(),
}));

const getCachedAudioBufferMock = vi.fn<(input: { bufferId: string }) => AudioBuffer | null>();
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: (input: { bufferId: string }) => getCachedAudioBufferMock(input),
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
const basicPitchCtor = vi.fn<(model: string | Promise<unknown>) => void>();
vi.mock('@tensorflow/tfjs', () => ({ loadGraphModel: vi.fn().mockResolvedValue({}) }));
vi.mock('@spotify/basic-pitch', () => ({
    BasicPitch: class {
        constructor(model: string | Promise<unknown>) {
            basicPitchCtor(model);
        }
        // No notes detected — keeps the use case's later stages trivial.
        evaluateModel(
            _buffer: unknown,
            onComplete: (f: number[][], o: number[][], c: number[][]) => void,
            _onProgress: (p: number) => void
        ): Promise<void> {
            return evaluate().then(() => onComplete([], [], []));
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
        getCachedAudioBufferMock.mockReset();
        loggerWarnMock.mockReset();
        basicPitchCtor.mockReset();
        releaseGate.basicPitch = true;
        sourceAuthority.revision = 'source-revision';
        evaluate.mockReset().mockResolvedValue(undefined);
        vi.mocked(noteFramesToTime).mockReturnValue([]);
    });

    it('rejects conversion while Basic Pitch artifacts are withheld', async () => {
        releaseGate.basicPitch = false;

        await expect(polyphonicAudioToMidi({ clipId: 'clip-1' })).rejects.toThrow(/not admitted in this release/);
        expect(getAllTracksMock).not.toHaveBeenCalled();
    });

    it('should return null and warn when clip is not found', async () => {
        const result = await polyphonicAudioToMidi({ clipId: 'missing-clip' });

        expect(result).toBeNull();
        expect(loggerWarnMock).toHaveBeenCalledWith(expect.stringContaining('Clip not found'));
    });

    it('should return null and warn when audio buffer is not found', async () => {
        const clip = {
            id: 'clip-1',
            audioBufferId: 'buf-1',
            name: 'Take 1',
            startBeat: 0,
            endBeat: 4,
        };
        getAllTracksMock.mockReturnValue([{ clips: [clip] }]);
        getCachedAudioBufferMock.mockReturnValue(null);

        const result = await polyphonicAudioToMidi({ clipId: 'clip-1' });

        expect(result).toBeNull();
        expect(getCachedAudioBufferMock).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(loggerWarnMock).toHaveBeenCalledWith(expect.stringContaining('Audio buffer not found: buf-1'));
        expect(basicPitchCtor).not.toHaveBeenCalled();
    });

    it('should construct the Basic Pitch model only once across concurrent first calls', async () => {
        const clip = {
            id: 'clip-1',
            audioBufferId: 'buf-1',
            name: 'Take 1',
            startBeat: 0,
            endBeat: 4,
        };
        getAllTracksMock.mockReturnValue([{ clips: [clip] }]);
        getCachedAudioBufferMock.mockReturnValue({
            sampleRate: 22050,
            length: 22050,
            duration: 1,
            numberOfChannels: 1,
        } as unknown as AudioBuffer);

        // Two callers race before either finishes loading the model. The
        // memoized load promise must coalesce them onto a single BasicPitch.
        await Promise.all([polyphonicAudioToMidi({ clipId: 'clip-1' }), polyphonicAudioToMidi({ clipId: 'clip-1' })]);

        expect(getCachedAudioBufferMock).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(basicPitchCtor).toHaveBeenCalledTimes(1);
    });

    it.each(['changed-source', 'cancelled', 'unchanged'] as const)(
        'retains its original owner through %s inference',
        async (transition) => {
            getAllTracksMock.mockReturnValue([
                { clips: [{ id: 'clip-1', audioBufferId: 'buf-1', name: 'Take', startBeat: 0, endBeat: 4 }] },
            ]);
            getCachedAudioBufferMock.mockReturnValue({
                sampleRate: 22050,
                length: 22050,
                duration: 1,
                numberOfChannels: 1,
            } as AudioBuffer);
            const notes = [{ pitchMidi: 60, startTimeSeconds: 0.2, durationSeconds: 0.3, amplitude: 0.8 }];
            vi.mocked(noteFramesToTime).mockReturnValue(notes);
            let enter!: () => void;
            let release!: () => void;
            const entered = new Promise<void>((resolve) => {
                enter = resolve;
            });
            const pending = new Promise<void>((resolve) => {
                release = resolve;
            });
            evaluate.mockImplementationOnce(() => {
                enter();
                return pending;
            });
            const controller = new AbortController();
            const analysis = polyphonicAudioToMidi({ clipId: 'clip-1', signal: controller.signal });
            await entered;
            if (transition === 'changed-source') {
                sourceAuthority.revision = 'replacement-revision';
            }
            if (transition === 'cancelled') {
                controller.abort();
            }
            release();
            const result = await analysis;
            if (transition !== 'unchanged') {
                expect(result).toBeNull();
            } else {
                expect(result).toEqual({
                    notes,
                    sourceClip: {
                        startBeat: 0,
                        endBeat: 4,
                        name: 'Take',
                        projectRevision: 'source-revision',
                        signal: controller.signal,
                    },
                });
            }
        }
    );
});
