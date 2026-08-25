import { describe, it, expect, vi, beforeEach } from 'vitest';

import { kneadStore, defaultKneadState } from '../../stores/kneadStore';
import { analyzeClipPitch } from '../analyzeClipPitch';
import { updateClipKneadState } from '../updateClipKneadState';

const { analyzePitchForClip, updateClipInStore } = vi.hoisted(() => ({
    analyzePitchForClip: vi.fn(),
    updateClipInStore: vi.fn(),
}));

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

function kneadState(): NonNullable<typeof kneadStore.value> {
    const state = kneadStore.value;
    if (!state) {
        throw new Error('expected knead store to be initialised');
    }
    return state;
}

// Mock the AudioEngine boundary: this orchestrator's job is to feed whatever
// contour the engine returns into ingestDspAnalysis. Knead -> AudioEngine is the
// safe direction, so we stub the engine call rather than run real analysis.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    analyzePitchForClip,
}));

// `updateClipInStore` is the persisted-clip boundary: a clip's `kneadState` is
// authored only through it. Stubbing it lets the tests below observe exactly
// when the analysis chain writes project state.
vi.mock('#/modules/Arrangement/stores', () => ({
    updateClipInStore,
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
        expect(kneadState().contours.c1).toEqual(contour);

        const clipState = kneadState().clips.c1;
        expect(clipState).toBeDefined();
        expect(clipState?.blobs.length).toBeGreaterThan(0);
        // Each blob carries its pitch center so the worklet shift is well-defined.
        expect(clipState?.blobs[0]?.pitchCenterCents).toBeGreaterThan(0);
        expect(kneadStore.value).toMatchObject({ isAnalyzing: false, analysisProgress: 1 });
    });

    // Regression (#2557): the Knead editor's mount effect fires this use case
    // the moment a clip is selected while pitch mode is the open audio-edit
    // mode (asserted by KneadEditor.spec's own 'triggers analysis when no
    // contour has been computed yet'). Analysis completing must leave the
    // clip's persisted `kneadState` untouched — `updateClipInStore` is the only
    // route to it — while the editor and engine still get the blobs from the
    // Knead store. Before the transient/persisting split, the ingest seeded a
    // default settings object (blobs included) onto a clip nobody edited: a
    // dirty project from browsing, written as if chosen and CRDT-synced.
    it('completes analysis without authoring the clip persisted kneadState (#2557)', async () => {
        const voicedPoints = Array.from({ length: 8 }, (_, index) => ({
            time_ms: index * 10,
            frequency_hz: 440,
            confidence: 0.9,
            voiced: true,
        }));
        analyzePitchForClip.mockImplementation((input: PitchAnalysisInput) => {
            input.onStart();
            return Promise.resolve({
                status: 'analyzed',
                contour: { points: voicedPoints, sample_rate: 44100, hop_size: 256, algorithm: 'pyin' },
            });
        });

        await analyzeClipPitch('c1');

        // The transient home holds the result: blobs plus the seeded default
        // settings the editor's controls read.
        const clipState = kneadState().clips.c1;
        expect(clipState).toBeDefined();
        expect(clipState?.blobs.length).toBeGreaterThan(0);
        expect(clipState?.retuneSpeedMs).toBe(25);
        // The persisted clip is unchanged: no blobs, no seeded defaults.
        expect(updateClipInStore).not.toHaveBeenCalled();
    });

    // Regression (#2557), the other half of the contract: the persisted state
    // is not gone, it is deferred. The first real edit — every Knead-editor
    // control writes through `updateClipKneadState` — materializes it, exactly
    // once, carrying the transient analysis (blobs) with it.
    it('persists blobs and settings exactly once on the first real edit, carrying the analysis over (#2557)', async () => {
        const voicedPoints = Array.from({ length: 8 }, (_, index) => ({
            time_ms: index * 10,
            frequency_hz: 440,
            confidence: 0.9,
            voiced: true,
        }));
        analyzePitchForClip.mockImplementation((input: PitchAnalysisInput) => {
            input.onStart();
            return Promise.resolve({
                status: 'analyzed',
                contour: { points: voicedPoints, sample_rate: 44100, hop_size: 256, algorithm: 'pyin' },
            });
        });
        await analyzeClipPitch('c1');
        updateClipInStore.mockClear();
        updateClipInStore.mockImplementation((_clipId: string, updater: (clip: { fileId: string }) => unknown) =>
            updater({ fileId: 'file-1' })
        );

        updateClipKneadState('c1', (state) => ({ ...state, retuneSpeedMs: 80 }));

        expect(updateClipInStore).toHaveBeenCalledTimes(1);
        const persisted = updateClipInStore.mock.results[0]?.value as {
            fileId: string;
            kneadState: { retuneSpeedMs: number; blobs: unknown[] };
        };
        expect(persisted.fileId).toBe('file-1');
        expect(persisted.kneadState.retuneSpeedMs).toBe(80);
        expect(persisted.kneadState.blobs.length).toBeGreaterThan(0);
    });

    it('does not ingest blobs when the engine resolves a clip with no buffer', async () => {
        const setSpy = vi.spyOn(kneadStore, 'set');
        analyzePitchForClip.mockResolvedValue({
            status: 'no-buffer',
            reason: 'missing-clip-or-buffer',
        });

        const outcome = await analyzeClipPitch('c1');

        expect(outcome).toEqual({ status: 'no-buffer', reason: 'missing-clip-or-buffer' });
        expect(kneadState().clips.c1).toBeUndefined();
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
        expect(kneadState().analysisProgress).toBe(0);

        secondProgress(0.4);
        expect(kneadState().analysisProgress).toBe(0.4);

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
        expect(kneadState().analysisProgress).toBe(0.6);

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
                expect(kneadState().contours.c1).toBeUndefined();
                secondAnalysis.resolve(secondOutcome);
                await secondRun;
            } else {
                secondAnalysis.resolve(secondOutcome);
                await secondRun;
                firstAnalysis.resolve(firstOutcome);
                await firstRun;
            }

            expect(kneadState().contours.c1?.algorithm).toBe('second');
        }
    );

    it('ignores a stray progress callback after its run has already finished', async () => {
        let capturedProgress: ((progress: number) => void) | undefined;
        analyzePitchForClip.mockImplementation((input: PitchAnalysisInput) => {
            input.onStart();
            capturedProgress = input.onProgress;
            return Promise.resolve({ status: 'analyzed', contour: createContour('done') });
        });

        await analyzeClipPitch('c1');
        expect(kneadStore.value).toMatchObject({ isAnalyzing: false, analysisProgress: 1 });

        // The run's runId was already deleted from activeAnalysisProgress on
        // completion; a late progress event for it must be a no-op rather than
        // reviving isAnalyzing/analysisProgress state for a dead run.
        capturedProgress?.(0.5);
        expect(kneadStore.value).toMatchObject({ isAnalyzing: false, analysisProgress: 1 });
    });

    it('does not throw when the knead store is unset while an analysis is in flight', async () => {
        let capturedOnStart: (() => void) | undefined;
        let capturedProgress: ((progress: number) => void) | undefined;
        analyzePitchForClip.mockImplementation((input: PitchAnalysisInput) => {
            capturedOnStart = input.onStart;
            capturedProgress = input.onProgress;
            return Promise.resolve({ status: 'analyzed', contour: createContour('unset') });
        });

        kneadStore.set(null);

        const run = analyzeClipPitch('c1');
        expect(() => capturedOnStart?.()).not.toThrow();
        expect(() => capturedProgress?.(0.5)).not.toThrow();
        expect(kneadStore.value).toBeNull();

        await run;
    });
});
