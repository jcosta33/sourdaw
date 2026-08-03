/**
 * AC-4 — main-thread stall budget, analysis leg: the parts that are not timing.
 *
 * ## Where the figures are
 *
 * **Not here.** Every AC-4 magnitude — per-span minima, both budgets, the
 * convergence gate, the regression ceilings — lives in
 * `scripts/measureStallBudget.ts`, run as `pnpm audio:stall-budget`. No figure
 * exists in both places.
 *
 * The split is not tidiness. **An assertion whose truth depends on wall-clock
 * time does not belong in the shared suite.** A vitest failure is a claim about
 * the product, and "the machine was too busy to measure" is not one; vitest has
 * pass, fail, and a skip that vanishes into an 18,000-test run, and none of them
 * says that. Run under 24 spinners at 1-minute load 21.74, the previous revision
 * of this file refused correctly — `summarizeFeatures ... drift 51.40% (NOT
 * CONVERGED)` — and reported the refusal as a test failure. The script has a
 * third exit code for exactly that case (2 = NOT MEASURED), the way
 * `pnpm audio:deadline` does for AC-3.
 *
 * What stays here is everything that reds on a code change and cannot red
 * because a box is busy.
 *
 * ## The two budgets the script measures against
 *
 * Restated so a reader landing here is not sent away for the definitions.
 *
 * - **10 ms — `scheduleGrainMs`** (`Transport/models/TransportState.ts:38`).
 *   The scheduler tick period: a responsiveness and automation-resolution
 *   threshold. Overrunning it loses no scheduled audio — each tick schedules a
 *   contiguous range and carries `lastScheduledBeat` forward
 *   (`startPlayheadScheduler.ts:358-359`, `:411`), and `tickInFlight`
 *   (`:159-162`) drops overrunning ticks deliberately. What it costs is the work
 *   applied at `newPosition` (`:395-407`), which lands late rather than early.
 * - **100 ms — `SCHEDULE_AHEAD_SECONDS = 0.1`** (`startPlayheadScheduler.ts:40`).
 *   The look-ahead horizon: the audio-correctness threshold. Exhaust it and
 *   `Transport/useCases/scheduling/scheduleAudioClips.ts:203-217` starts the
 *   clip mid-buffer.
 *
 * An earlier revision called 10 ms "one `SCHEDULE_AHEAD_SECONDS` grain" and "the
 * point past which a user hears the stall" — wrong constant by 10x, wrong
 * mechanism. Fixed here, in the script, and at its origin in
 * `.agents/specs/render-parity-instrumentation/spec.md` AC-4.
 *
 * ## The finding this leg exists for
 *
 * That `ClipAudioAiSection`'s Analyze handler runs both analyses synchronously
 * and cannot paint its spinner is asserted behaviourally, with no clock, in
 * `TimelineEditor/presentations/views/Inspector/__tests__/ClipAudioAiSection.analyzeStall.spec.tsx`.
 * A timing assertion never had to carry that claim.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

const SAMPLE_RATE = 48_000;

/**
 * Ten seconds, the same take the script measures.
 *
 * Shortening it was the obvious saving once the timing left this file, and it
 * does not work: `detectTempo` returns null at two seconds and at six. Its
 * inter-onset autocorrelation needs more of the grid than that, and a fixture
 * that starves a detector turns its pin into a test of the fixture. One pass of
 * all five detectors over 10 s costs about half a second, which is the price of
 * these pins meaning anything.
 */
const FIXTURE_SECONDS = 10;

/**
 * `audioToMidi`'s shipping defaults (`sensitivity = 0.5`, `minInterval = 0.25`
 * beats against the 120 BPM default transport).
 *
 * Note the scope: this is `mode: 'rhythm'`. `mode: 'pitched'` additionally runs
 * a per-onset O(searchEnd^2) autocorrelation inside `audioToMidi`, which is not
 * separately callable and is listed in the `unmeasured` annotation below.
 */
const ONSET_SENSITIVITY = 0.5;
const ONSET_MIN_INTERVAL_SEC = 0.25 / (120 / 60);

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
 * gives the key detector a single unambiguous bin, so the assertions below would
 * be satisfied by an early-out rather than by the work. This is a sustained
 * triad plus periodic percussive transients plus broadband noise, deterministic
 * by construction (a fixed LCG, no `Math.random`).
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

// The audio-cache read is AudioEngine's boundary, not analysis DSP. Everything
// downstream of it — meyda, pitchy, the Goertzel loop, the onset detector — is
// the real shipping implementation running on the real fixture PCM. The script
// does not mock this at all: it loads the real barrel, so `audioBufferCache`'s
// IndexedDB access-time refresh is inside its figures rather than absent.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: ({ bufferId }: { bufferId: string }) => (bufferId === 'take' ? take : null),
}));

const { detectOnsets } = await import('../detectOnsets');
const { detectKey } = await import('../keyDetection');
const { detectTempo } = await import('../tempoDetection');
const { summarizeFeatures } = await import('../summarizeFeatures');
const { detectDominantPitch } = await import('../pitchDetection');

describe('AudioAnalysis main-thread stall budget — non-timing pins', () => {
    it('each detector returns real results on a real take, so the script is not timing an early-out', () => {
        const key = detectKey('take');
        const tempo = detectTempo('take');
        const onsets = detectOnsets(asAudioBuffer(take), ONSET_SENSITIVITY, ONSET_MIN_INTERVAL_SEC);
        const features = summarizeFeatures('take');
        const pitch = detectDominantPitch('take');

        // Counts and shapes, not "not empty". A detector that degraded to a
        // handful of results would still red. The fixture carries one transient
        // every 500 ms, so over 10 s a working onset detector finds around twenty;
        // the meyda hop loop at bufferSize 2048 / hopSize 512 yields ~930 frames
        // over the same span.
        //
        // This is the guard behind every figure the script publishes: if the DSP
        // finds nothing to do, the script is timing an early-out and its
        // magnitudes are fiction. `scripts/measureStallBudget.ts` re-checks the
        // same facts at its own fixture length before it reports anything, so
        // the property is pinned on both sides of the split.
        expect({
            key: typeof key?.key,
            tempoIsPositive: (tempo ?? 0) > 0,
            onsetCount: onsets.length > 10,
            frameCount: (features?.frameCount ?? 0) > 800,
            pitchIsMidi: typeof pitch?.midiPitch === 'number',
            pitchInAudibleRange: (pitch?.frequency ?? 0) > 20 && (pitch?.frequency ?? 0) < 5000,
        }).toEqual({
            key: 'string',
            tempoIsPositive: true,
            onsetCount: true,
            frameCount: true,
            pitchIsMidi: true,
            pitchInAudibleRange: true,
        });
    });

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
            "audioToMidi mode 'pitched': unmeasured. The figure the script reports for detectOnsets " +
                "covers mode 'rhythm' only. The pitched mode adds a per-onset O(searchEnd^2) " +
                'autocorrelation inside audioToMidi that is not separately callable, so timing it ' +
                'would require timing audioToMidi end to end against a fixture whose onset count ' +
                'drives the cost — a different instrument, not a wider one.',
            'handleStemSeparationPreview (AiGeneration/useCases/actions): unmeasured. It sits ' +
                'on the same Inspector panel as the Analyze handler and calls audioBufferToWav ' +
                'then separateStems, i.e. the Demucs path above, so it inherits that exclusion. ' +
                'Its own synchronous share is the WAV encode, which needs a real AudioBuffer.',
            'handleAiDenoiseClip (AiGeneration/useCases/actions): unmeasured. Same panel. ' +
                'Under Tauri the work crosses to the native bridge; in the browser branch it ' +
                'runs a spectral-subtraction loop on the main thread and then materialises the ' +
                "result through OfflineAudioContext.createBuffer, which jsdom's stub lacks.",
            'All of these need the Playwright rig (tests/e2e) or a manual browser session. ' +
                'Reporting a jsdom number for any of them would describe the harness, not the product.',
        ];
        for (const line of unmeasured) {
            await annotate(line, 'notice');
        }

        // Not a timing claim — a source-level one, and the narrowest piece of
        // the two survey allegations that can be settled without a browser.
        //
        // Be precise about what the scan establishes: neither call site's own
        // source text constructs a `Worker`. That is all. It says nothing about
        // onnxruntime-web or TensorFlow.js, both of which spawn their own
        // WASM-thread worker pools internally — so this is NOT evidence that the
        // work lands on the page's main thread, only that the call site does
        // nothing to move it off. `BrowserAi/repositories/inferenceWorkerBridge.ts`
        // is the in-repo counter-example of a call site that does.
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
