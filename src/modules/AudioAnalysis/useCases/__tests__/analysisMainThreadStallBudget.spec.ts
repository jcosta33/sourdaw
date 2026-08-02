/**
 * AC-4 — main-thread stall budget, analysis leg.
 *
 * ## The budget: 10 ms
 *
 * One `SCHEDULE_AHEAD_SECONDS` grain. The transport scheduler runs on a worker
 * with a look-ahead window (`src/modules/Transport/workers/schedulerWorker.ts`);
 * the main thread is what turns each scheduler tick into `AudioParam` and
 * `start()` calls. A main-thread task longer than one grain means the tick that
 * should have scheduled the next window queues behind it, and notes land late.
 * 10 ms is therefore not a comfort target — it is the point past which a user
 * hears the stall.
 *
 * Do not widen it. If an operation exceeds it, that is a finding about the
 * operation, and the fix is to yield, chunk, or move it off-thread — not to
 * raise the number here.
 *
 * ## What this measures, and where
 *
 * Every analysis entry point below is pure JavaScript over a `Float32Array`,
 * invoked synchronously from a command handler or a React click handler with no
 * yield between entry and return. That is exactly the shape the budget is about,
 * and it is fully faithful under Node + jsdom: the DSP here is the shipping code
 * running on real PCM. Nothing is stubbed except the audio-cache read boundary,
 * which hands back the fixture buffer.
 *
 * ## What this does NOT measure — see the `unmeasured` annotation below
 *
 * `polyphonicAudioToMidi` (basic-pitch / TensorFlow.js) and
 * `separateStemsBrowser` (Demucs / onnxruntime-web) are the two heaviest
 * main-thread claims in this area and neither can be measured here. Their cost
 * lives in WebGPU/WASM backends, `decodeAudioData` and
 * `OfflineAudioContext.startRendering` — all of which jsdom either lacks or
 * stubs (`src/setupTests.ts` supplies an `OfflineAudioContext` with no
 * `createBuffer` and no `startRendering`). A number produced here would describe
 * the harness, not the product. They are reported as unmeasured, with the
 * source-level facts that *can* be established by reading, kept separate from
 * the timings.
 */

import { readFileSync } from 'node:fs';
import os from 'node:os';
import { resolve } from 'node:path';

import { beforeAll, describe, it, expect, vi } from 'vitest';

const SAMPLE_RATE = 48_000;

/**
 * 30 seconds. Long enough to be a real take rather than a test tone, short
 * enough that the whole harness stays inside a normal suite run. Every figure
 * is also reported per second of audio so it can be scaled to any clip length
 * without re-running.
 */
const FIXTURE_SECONDS = 30;

/**
 * Far above any plausible measurement, so the assertions below are what decide
 * the verdict. Without it these cases inherit vitest's 5000 ms default, and a
 * harness that intends to report "1200 ms, four times over budget" would instead
 * fail as `Test timed out in 5000ms` — a threshold nobody wrote, firing as a
 * flake rather than as the property.
 */
const MEASUREMENT_TIMEOUT_MS = 600_000;

/** AC-4's budget, in milliseconds. One `SCHEDULE_AHEAD_SECONDS` grain. */
const STALL_BUDGET_MS = 10;

/**
 * `audioToMidi`'s shipping defaults (`sensitivity = 0.5`, `minInterval = 0.25`
 * beats, resolved against the 120 BPM default transport). Measuring the
 * configuration the product actually runs, rather than one invented here.
 *
 * Note the scope: this is `mode: 'rhythm'`. `mode: 'pitched'` additionally runs
 * a per-onset O(searchEnd^2) autocorrelation inside `audioToMidi`, which is not
 * separately callable and is therefore **not** covered by the figure below.
 */
const ONSET_SENSITIVITY = 0.5;
const ONSET_MIN_INTERVAL_SEC = 0.25 / (120 / 60);

/**
 * Recorded breaches.
 *
 * These are measurements, not targets. Each entry pins an operation that is
 * already over `STALL_BUDGET_MS` on the reference machine, so the harness can
 * assert something that fails in both directions: it reds if the operation gets
 * an order of magnitude worse, and it reds when the operation is *fixed* — which
 * is the point at which the entry must be deleted and the real budget asserted
 * instead. The second direction is the one that matters; the ceiling is a
 * backstop.
 *
 * **The ceilings are deliberately an order of magnitude above the observed
 * figure, and that is not laziness.** This harness runs inside a parallel test
 * runner and cannot control machine load: the same span measured 781 ms alone
 * and 1913 ms with one other spec file running beside it. A tight ceiling on a
 * wall clock in that environment is a flake, not a guard. These catch a
 * catastrophic regression; the precise numbers live in the annotations, which is
 * where a reader should look.
 */
const RECORDED_BREACHES = {
    /**
     * `detectKey` — the Goertzel chroma loop in `keyDetection.ts`. Four nested
     * loops: frames (hop 2048) x 12 pitch classes x 6 octaves x a 4096-sample
     * inner recurrence, with no yield, invoked synchronously from
     * `handleDetectKey.execute`.
     */
    detectKey: { ceilingMs: 30_000, reason: 'Goertzel chroma: 12 x 6 bins x 4096-tap recurrence per 2048-sample hop' },
    /**
     * `summarizeFeatures` — the meyda hop loop in `audioFeatures.ts`, ~94 FFT +
     * MFCC + chroma extractions per second of audio at the default
     * bufferSize 2048 / hopSize 512.
     */
    summarizeFeatures: { ceilingMs: 40_000, reason: 'meyda: 9 features per hop, ~94 hops per second of audio' },
    /** `detectDominantPitch` — pitchy MPM per hop, via `trackPitch`. */
    detectDominantPitch: { ceilingMs: 30_000, reason: 'pitchy MPM autocorrelation per hop' },
} as const;

type FixtureBuffer = Pick<AudioBuffer, 'sampleRate' | 'getChannelData'>;

/**
 * `detectOnsets` is typed against `AudioBuffer` but reads only `sampleRate` and
 * `getChannelData(0)`, and jsdom has no `AudioBuffer` constructor to build a
 * real one with. The fixture supplies exactly those two members; this adapter is
 * the single seam where that is admitted, rather than a cast at every call site.
 */
function asAudioBuffer(fixture: FixtureBuffer): AudioBuffer {
    return fixture as AudioBuffer;
}

/**
 * A take, not a test tone. A pure sine makes onset detection return nothing and
 * gives the key detector a single unambiguous bin, so the measurement would be
 * of the early-out rather than of the work. This is a sustained triad plus
 * periodic percussive transients plus broadband noise: every stage below has
 * real content to chew on.
 *
 * Deterministic by construction (a fixed LCG, no `Math.random`), so two runs
 * measure the same signal.
 */
function createTakeFixture(seconds: number): FixtureBuffer {
    const length = Math.floor(seconds * SAMPLE_RATE);
    const data = new Float32Array(length);
    const triad = [261.626, 329.628, 391.995];
    let seed = 0x2545_f491;
    for (let index = 0; index < length; index++) {
        const time = index / SAMPLE_RATE;
        let sample = 0;
        for (const frequency of triad) {
            sample += Math.sin(2 * Math.PI * frequency * time) / triad.length;
        }
        // A transient every 500 ms (120 BPM), decaying over ~40 ms.
        const sinceHit = time % 0.5;
        if (sinceHit < 0.04) {
            sample += Math.exp(-sinceHit * 120) * 0.9 * Math.sin(2 * Math.PI * 90 * sinceHit);
        }
        seed = (seed * 1_103_515_245 + 12_345) & 0x7fff_ffff;
        sample += (seed / 0x7fff_ffff - 0.5) * 0.05;
        data[index] = sample * 0.7;
    }
    return { sampleRate: SAMPLE_RATE, getChannelData: () => data };
}

const take = createTakeFixture(FIXTURE_SECONDS);
/** Short buffer used only to tier up the JIT before anything is timed. */
const warmUp = createTakeFixture(0.5);

// The audio-cache read is AudioEngine's boundary, not analysis DSP. Everything
// downstream of it — meyda, pitchy, the Goertzel loop, the onset detector — is
// the real shipping implementation running on the real fixture PCM.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: ({ bufferId }: { bufferId: string }) => {
        if (bufferId === 'take') {
            return take;
        }
        if (bufferId === 'warm-up') {
            return warmUp;
        }
        return null;
    },
}));

const { detectOnsets } = await import('../detectOnsets');
const { detectKey } = await import('../keyDetection');
const { detectTempo } = await import('../tempoDetection');
const { summarizeFeatures } = await import('../summarizeFeatures');
const { detectDominantPitch } = await import('../pitchDetection');

/**
 * Repeats and reports the **minimum**.
 *
 * Wall clock noise is one-sided — a background task can only make a span look
 * slower — so the minimum of several samples is the least contaminated estimate
 * of what the code costs, and it is stable where a single cold sample is not.
 * Everything asserted below reads `minMs`; median and max are reported so the
 * spread is visible.
 *
 * Sample counts differ by operation, deliberately. The two cheap detectors are
 * the ones asserted to fit *inside* the budget, and that verdict is only safe
 * when the minimum is close to the true cost — so they get many samples, which
 * costs milliseconds. The three expensive ones are tens of times over the
 * budget, where a factor-of-two error changes nothing, so they get few samples,
 * because each pass is most of a second.
 */
const SAMPLES_CHEAP = 15;
const SAMPLES_EXPENSIVE = 3;

type Measurement<Result = unknown> = {
    result: Result;
    minMs: number;
    medianMs: number;
    maxMs: number;
    samples: number;
};

function measure<Result>(operation: () => Result, repeats: number): Measurement<Result> {
    const firstStartedAt = performance.now();
    let result = operation();
    const samples: number[] = [performance.now() - firstStartedAt];
    for (let index = 1; index < repeats; index++) {
        const startedAt = performance.now();
        result = operation();
        samples.push(performance.now() - startedAt);
    }
    samples.sort((left, right) => left - right);
    return {
        result,
        minMs: samples[0]!,
        medianMs: samples[Math.floor(samples.length / 2)]!,
        maxMs: samples.at(-1)!,
        samples: samples.length,
    };
}

function describeMachine(): string {
    const cpu = os.cpus()[0]?.model ?? 'unknown CPU';
    const memoryGiB = Math.round(os.totalmem() / 1024 ** 3);
    return (
        `${cpu}, ${os.cpus().length} logical cores, ${memoryGiB} GiB, ` +
        `${os.platform()} ${os.release()} ${os.arch()}, Node ${process.version}, jsdom (vitest)`
    );
}

function report(name: string, measurement: Measurement): string {
    const overBudget = measurement.minMs / STALL_BUDGET_MS;
    return (
        `${name}: min ${measurement.minMs.toFixed(2)} ms = ${overBudget.toFixed(1)}x the ${STALL_BUDGET_MS} ms budget ` +
        `for ${FIXTURE_SECONDS}s of ${SAMPLE_RATE} Hz mono ` +
        `(${(measurement.minMs / FIXTURE_SECONDS).toFixed(2)} ms per audio second; ` +
        `median ${measurement.medianMs.toFixed(2)}, max ${measurement.maxMs.toFixed(2)}, ` +
        `${measurement.samples} samples)`
    );
}

describe('AudioAnalysis main-thread stall budget', () => {
    // One warm-up pass per code path, untimed, so the figures below exclude
    // first-call JIT tier-up rather than attributing it to the operation.
    beforeAll(() => {
        detectKey('warm-up');
        detectTempo('warm-up');
        detectOnsets(asAudioBuffer(warmUp), ONSET_SENSITIVITY, ONSET_MIN_INTERVAL_SEC);
        summarizeFeatures('warm-up');
        detectDominantPitch('warm-up');
    });

    it(
        'reports every synchronous analysis entry point against the 10 ms grain',
        async ({ annotate }) => {
            await annotate(`machine: ${describeMachine()}`, 'notice');

            const key = measure(() => detectKey('take'), SAMPLES_EXPENSIVE);
            const tempo = measure(() => detectTempo('take'), SAMPLES_CHEAP);
            const onsets = measure(
                () => detectOnsets(asAudioBuffer(take), ONSET_SENSITIVITY, ONSET_MIN_INTERVAL_SEC),
                SAMPLES_CHEAP
            );
            const features = measure(() => summarizeFeatures('take'), SAMPLES_EXPENSIVE);
            const pitch = measure(() => detectDominantPitch('take'), SAMPLES_EXPENSIVE);

            for (const [name, measurement] of [
                ['detectKey', key],
                ['detectTempo', tempo],
                ['detectOnsets', onsets],
                ['summarizeFeatures', features],
                ['detectDominantPitch', pitch],
            ] as const) {
                await annotate(report(name, measurement), 'notice');
            }

            // The Analyze button in `ClipAudioAiSection` runs these two
            // back-to-back inside one synchronous click handler, with
            // `setIsAnalyzing(true)` before and `false` after — neither of which
            // can paint, because nothing yields in between. The pair is the
            // stall the user actually experiences, so it is reported as one.
            const analyzeButtonMs = features.minMs + pitch.minMs;
            await annotate(
                `ClipAudioAiSection Analyze click handler (summarizeFeatures + detectDominantPitch): ` +
                    `${analyzeButtonMs.toFixed(2)} ms = ${(analyzeButtonMs / STALL_BUDGET_MS).toFixed(1)}x ` +
                    `the ${STALL_BUDGET_MS} ms budget, one uninterrupted task`,
                'notice'
            );

            // Fixture pin. Every timing above is meaningless if the DSP found
            // nothing to do: a detector that early-outs on silence is fast, and
            // a harness that only times early-outs measures itself. These assert
            // the fixture drove each path to a real result.
            // The fixture carries one transient every 500 ms over 30 s, so a
            // working onset detector finds tens of them; the meyda hop loop at
            // bufferSize 2048 / hopSize 512 yields ~2800 frames over the same
            // span. Both are asserted as counts rather than as "not empty", so a
            // detector that degraded to a handful of results would still red.
            expect({
                key: typeof key.result?.key,
                tempoIsPositive: (tempo.result ?? 0) > 0,
                onsetCount: onsets.result.length > 30,
                frameCount: (features.result?.frameCount ?? 0) > 2000,
                pitchIsMidi: typeof pitch.result?.midiPitch === 'number',
            }).toEqual({
                key: 'string',
                tempoIsPositive: true,
                onsetCount: true,
                frameCount: true,
                pitchIsMidi: true,
            });

            // Within budget today. These are the real AC-4 assertions: they red
            // if either operation grows past one scheduler grain.
            expect({
                detectTempoWithinBudget: tempo.minMs < STALL_BUDGET_MS,
                detectOnsetsWithinBudget: onsets.minMs < STALL_BUDGET_MS,
            }).toEqual({ detectTempoWithinBudget: true, detectOnsetsWithinBudget: true });

            // Over budget today. Asserted as breaches so the harness reds both
            // when they regress and when they are fixed — a fix must delete the
            // entry from RECORDED_BREACHES and move the operation above. All
            // three are tens of times over the grain, so the verdict is not
            // sensitive to wall-clock noise the way a near-budget span would be.
            expect({
                detectKey: key.minMs > STALL_BUDGET_MS && key.minMs < RECORDED_BREACHES.detectKey.ceilingMs,
                summarizeFeatures:
                    features.minMs > STALL_BUDGET_MS && features.minMs < RECORDED_BREACHES.summarizeFeatures.ceilingMs,
                detectDominantPitch:
                    pitch.minMs > STALL_BUDGET_MS && pitch.minMs < RECORDED_BREACHES.detectDominantPitch.ceilingMs,
            }).toEqual({ detectKey: true, summarizeFeatures: true, detectDominantPitch: true });
        },
        MEASUREMENT_TIMEOUT_MS
    );

    it('records what cannot be measured in jsdom, and why', async ({ annotate }) => {
        const unmeasured = [
            'polyphonicAudioToMidi (@spotify/basic-pitch + TensorFlow.js): unmeasured. ' +
                'Its cost is model evaluation on the tfjs WebGL/WASM backend plus an ' +
                'OfflineAudioContext resample to 22050 Hz; jsdom supplies neither. ' +
                'The existing spec mocks the whole basic-pitch module and feeds a ' +
                '22050 Hz buffer so the resample branch never runs.',
            'separateStemsBrowser (Demucs via onnxruntime-web): unmeasured. Requires a ' +
                '~235 MB ONNX model over the network, a WebGPU or WASM execution ' +
                'provider, decodeAudioData and OfflineAudioContext.startRendering. ' +
                'It has no direct spec at all; separateStems.spec.ts mocks the module away.',
            'Both need the Playwright rig (tests/e2e) or a manual browser session, not jsdom. ' +
                'Reporting a jsdom number for either would describe the harness, not the product.',
        ];
        for (const line of unmeasured) {
            await annotate(line, 'notice');
        }

        // Not a timing claim — a source-level one, and the only part of the two
        // survey allegations that can be settled without a browser. Both call
        // sites resolve their heavy dependency into the page realm; neither
        // constructs a Worker. `BrowserAi/repositories/inferenceWorkerBridge.ts`
        // is the in-repo counter-example that does.
        //
        // Read off disk rather than imported: these are source-text assertions,
        // and importing them would create module edges this spec has no business
        // having (one of them crosses a module boundary into a private folder).
        const readSource = (relativePath: string): string => readFileSync(resolve(process.cwd(), relativePath), 'utf8');
        const constructsAWorker = (source: string): boolean => /new Worker\(/.test(source);

        expect({
            demucs: constructsAWorker(readSource('src/modules/AudioAnalysis/repositories/browserStemSeparation.ts')),
            basicPitch: constructsAWorker(readSource('src/modules/AudioAnalysis/useCases/polyphonicAudioToMidi.ts')),
            // The presence pin (ADR 0015 rule 4): the pattern the two absence
            // assertions above rely on is asserted to match somewhere, so a
            // rename or a refactor of the Worker construction cannot silently
            // disarm them.
            browserAiCounterExample: constructsAWorker(
                readSource('src/modules/BrowserAi/repositories/inferenceWorkerBridge.ts')
            ),
        }).toEqual({
            demucs: false,
            basicPitch: false,
            browserAiCounterExample: true,
        });
    });
});
