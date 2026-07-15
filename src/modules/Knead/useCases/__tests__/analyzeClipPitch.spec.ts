import { describe, it, expect, vi, beforeEach } from 'vitest';

import { kneadStore, defaultKneadState } from '../../stores/kneadStore';
import { analyzeClipPitch } from '../analyzeClipPitch';

const { analyzePitchForClip } = vi.hoisted(() => ({ analyzePitchForClip: vi.fn() }));

type PitchAnalysisInput = {
    clipId: string;
    onStart: () => void;
    onProgress: (progress: number) => void;
};

type AnalysisOutcome = Awaited<ReturnType<typeof analyzeClipPitch>>;

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
    let resolveDeferred!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
        resolveDeferred = resolve;
    });

    return { promise, resolve: resolveDeferred };
}

function createContour(algorithm: string) {
    return {
        points: [],
        sample_rate: 44100,
        hop_size: 256,
        algorithm,
    };
}

// Mock the AudioEngine boundary: this orchestrator's job is to feed whatever
// contour the engine returns into ingestDspAnalysis. Knead -> AudioEngine is the
// safe direction, so we stub the engine call rather than run real analysis.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    analyzePitchForClip,
}));

// updateClipKneadState (run for real below) also writes the Arrangement store;
// stub that side so the test stays focused on the Knead store.
vi.mock('#/modules/Arrangement/stores', () => ({
    updateClipInStore: vi.fn(),
}));

describe('analyzeClipPitch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        kneadStore.set({ ...defaultKneadState, clips: {}, contours: {} });
    });

    it('populates editable blobs from the analysed contour so the editor is not stuck re-analysing', async () => {
        // Regression (relocated from analyzePitchForClip): the analysis pipeline
        // must convert the contour into editable NoteBlobs, otherwise `blobs`
        // stays empty and the editor overlay (gated on blobs.length === 0)
        // re-triggers analysis forever. A run of contiguous voiced frames
        // (>= MIN_BLOB_FRAMES) at a steady pitch finalises one blob.
        const voicedPoints = Array.from({ length: 8 }, (_, index) => ({
            time_ms: index * 10,
            frequency_hz: 440,
            confidence: 0.9,
            voiced: true,
        }));
        const contour = {
            points: voicedPoints,
            sample_rate: 44100,
            hop_size: 256,
            algorithm: 'pyin',
        };
        analyzePitchForClip.mockImplementation((input: PitchAnalysisInput) => {
            input.onStart();
            return Promise.resolve({ status: 'analyzed', contour });
        });

        const outcome = await analyzeClipPitch('c1');

        expect(analyzePitchForClip).toHaveBeenCalledWith({
            clipId: 'c1',
            onStart: expect.any(Function),
            onProgress: expect.any(Function),
        });
        expect(outcome.status).toBe('analyzed');
        expect(kneadStore.value.contours.c1).toEqual(contour);

        const clipState = kneadStore.value.clips.c1;
        expect(clipState).toBeDefined();
        expect(clipState?.blobs.length).toBeGreaterThan(0);
        // Each blob carries its pitch center so the worklet shift is well-defined.
        expect(clipState?.blobs[0]?.pitchCenterCents).toBeGreaterThan(0);
        expect(kneadStore.value).toMatchObject({ isAnalyzing: false, analysisProgress: 1 });
    });

    it('does not ingest blobs when the engine resolves a clip with no buffer', async () => {
        const setSpy = vi.spyOn(kneadStore, 'set');
        analyzePitchForClip.mockResolvedValue({
            status: 'no-buffer',
            reason: 'missing-clip-or-buffer',
        });

        const outcome = await analyzeClipPitch('c1');

        expect(outcome).toEqual({ status: 'no-buffer', reason: 'missing-clip-or-buffer' });
        expect(kneadStore.value.clips.c1).toBeUndefined();
        expect(kneadStore.value).toMatchObject({ isAnalyzing: false, analysisProgress: 0 });
        expect(setSpy).not.toHaveBeenCalled();
        setSpy.mockRestore();
    });

    it('clears its analysis state when the AudioEngine analysis rejects', async () => {
        analyzePitchForClip.mockImplementation((input: PitchAnalysisInput) => {
            input.onStart();
            return Promise.reject(new Error('Pitch analysis failed'));
        });

        await expect(analyzeClipPitch('c1')).rejects.toThrow('Pitch analysis failed');

        expect(kneadStore.value).toMatchObject({ isAnalyzing: false, analysisProgress: 0 });
    });

    it('keeps a newer run active when an older analysis reports progress or completes', async () => {
        const firstAnalysis = createDeferred<AnalysisOutcome>();
        const secondAnalysis = createDeferred<AnalysisOutcome>();
        const progressCallbacks = new Map<string, (progress: number) => void>();
        const firstOutcome: AnalysisOutcome = { status: 'analyzed', contour: createContour('first') };
        const secondOutcome: AnalysisOutcome = { status: 'analyzed', contour: createContour('second') };

        analyzePitchForClip.mockImplementation((input: PitchAnalysisInput) => {
            input.onStart();
            if (input.clipId === 'c1') {
                progressCallbacks.set('c1', input.onProgress);
                return firstAnalysis.promise;
            }

            if (input.clipId === 'c2') {
                progressCallbacks.set('c2', input.onProgress);
                return secondAnalysis.promise;
            }

            return Promise.resolve({ status: 'no-buffer', reason: 'missing-clip-or-buffer' });
        });

        const firstRun = analyzeClipPitch('c1');
        const secondRun = analyzeClipPitch('c2');

        expect(kneadStore.value).toMatchObject({ isAnalyzing: true, analysisProgress: 0 });

        const firstProgress = progressCallbacks.get('c1');
        const secondProgress = progressCallbacks.get('c2');
        if (!firstProgress || !secondProgress) {
            throw new Error('Expected each analysis run to receive a progress callback');
        }

        firstProgress(0.8);
        expect(kneadStore.value.analysisProgress).toBe(0);

        secondProgress(0.4);
        expect(kneadStore.value.analysisProgress).toBe(0.4);

        firstAnalysis.resolve(firstOutcome);
        await firstRun;

        expect(kneadStore.value).toMatchObject({ isAnalyzing: true, analysisProgress: 0.4 });

        secondAnalysis.resolve(secondOutcome);
        await secondRun;

        expect(kneadStore.value).toMatchObject({ isAnalyzing: false, analysisProgress: 1 });
    });

    it('falls back to an older active run when the newer run completes first', async () => {
        const firstAnalysis = createDeferred<AnalysisOutcome>();
        const secondAnalysis = createDeferred<AnalysisOutcome>();
        const progressCallbacks = new Map<string, (progress: number) => void>();

        analyzePitchForClip.mockImplementation((input: PitchAnalysisInput) => {
            input.onStart();
            progressCallbacks.set(input.clipId, input.onProgress);
            return input.clipId === 'c1' ? firstAnalysis.promise : secondAnalysis.promise;
        });

        const firstRun = analyzeClipPitch('c1');
        const secondRun = analyzeClipPitch('c2');
        progressCallbacks.get('c1')?.(0.3);
        progressCallbacks.get('c2')?.(0.7);

        secondAnalysis.resolve({ status: 'analyzed', contour: createContour('second') });
        await secondRun;

        expect(kneadStore.value).toMatchObject({ isAnalyzing: true, analysisProgress: 0.3 });

        progressCallbacks.get('c1')?.(0.6);
        expect(kneadStore.value.analysisProgress).toBe(0.6);

        firstAnalysis.resolve({ status: 'analyzed', contour: createContour('first') });
        await firstRun;

        expect(kneadStore.value).toMatchObject({ isAnalyzing: false, analysisProgress: 1 });
    });

    it.each(['older-first', 'newer-first'] as const)(
        'keeps only the newest same-clip result when %s completes',
        async (completionOrder) => {
            const firstAnalysis = createDeferred<AnalysisOutcome>();
            const secondAnalysis = createDeferred<AnalysisOutcome>();
            let invocation = 0;

            analyzePitchForClip.mockImplementation((input: PitchAnalysisInput) => {
                input.onStart();
                invocation += 1;
                return invocation === 1 ? firstAnalysis.promise : secondAnalysis.promise;
            });

            const firstRun = analyzeClipPitch('c1');
            const secondRun = analyzeClipPitch('c1');
            const firstOutcome: AnalysisOutcome = { status: 'analyzed', contour: createContour('first') };
            const secondOutcome: AnalysisOutcome = { status: 'analyzed', contour: createContour('second') };

            if (completionOrder === 'older-first') {
                firstAnalysis.resolve(firstOutcome);
                await firstRun;
                expect(kneadStore.value.contours.c1).toBeUndefined();
                secondAnalysis.resolve(secondOutcome);
                await secondRun;
            } else {
                secondAnalysis.resolve(secondOutcome);
                await secondRun;
                firstAnalysis.resolve(firstOutcome);
                await firstRun;
            }

            expect(kneadStore.value.contours.c1?.algorithm).toBe('second');
        }
    );
});
