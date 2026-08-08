/**
 * How far does a Yeast generator land from the beat it is supposed to be on?
 *
 * Phase 3 of the remediation programme states the defect as "Yeast generators
 * phase-lock to the first block they see", and Phase 2's fixture set has to
 * stay Yeast-free until it is fixed, because a null test over a Yeast fixture
 * reds for reasons unrelated to whatever is being tested. That is a claim about
 * a magnitude, and nobody had measured the magnitude. This does.
 *
 * The budget is the programme's, not this file's: **scheduled-event placement
 * error <= 1 sample against the tempo-map integral, and inter-track skew for
 * the same beat = 0 samples.**
 *
 * Why there is no browser here
 * ----------------------------
 * Yeast has no audio-rate path and no wall clock. Every generator is a plain TS
 * class driven by `processMidi(input, output, transport)` with an explicit
 * `TransportInfo`, so the whole question is deterministic and a real browser
 * would only add noise. `scripts/measureTransportClock.ts` is the browser
 * instrument, for the questions that genuinely need one. Keeping them apart is
 * the point: it separates "the scheduler drifts" from "the machine was busy".
 *
 * The generators are the product's own classes, imported, not paraphrased.
 *
 * The three probes
 * ----------------
 * ANCHOR — the same generator, the same musical content, two different first
 *   blocks. The programme's "two runs of the same project differ" claim in its
 *   testable form. Reports the divergence in emitted sample times between the
 *   runs, and each run's offset from the absolute grid.
 *
 * TRUNCATION — `EuclideanGenerator.ts:86` and its siblings bound the emit loop
 *   at `safety < 64` and leave `lastStepTime` behind when they hit it, so the
 *   generator does not merely skip output, it falls permanently out of phase.
 *   Drives a lookahead window wide enough to reach the bound and reports the
 *   phase debt.
 *
 * ACCUMULATOR — `CCGenerator.ts:94` advances `accumPhase` by a whole 64-sample
 *   increment per loop iteration regardless of how much of the block is left,
 *   so a block length that is not a multiple of 64 over-advances by up to 63
 *   samples' worth, cumulatively and unboundedly. Drives realistic
 *   beat-derived block lengths and reports the accumulated error.
 *
 * Exit code is always 0. This reports magnitudes; the verdict on whether they
 * are acceptable belongs to the design decision it feeds.
 *
 * Usage: `pnpm transport:yeast-drift`
 */

import { createServer } from 'vite';

/**
 * The generator classes are loaded through the project's own Vite pipeline
 * rather than imported directly, because `src/` uses extensionless specifiers
 * and the `#/` alias that only Vite's resolver understands. Loading them any
 * other way would mean maintaining a second resolution story that can drift
 * from the one the app builds with — and the whole point of this harness is
 * that it measures the shipped classes, not a copy of them.
 *
 * These paths reach into `Yeast/workers/processors/`, which is a private folder
 * behind the module's contract barrels, and they are strings rather than
 * imports, so nothing type-checks them and nothing renames them for you. That
 * is deliberate and it is a real cost: **if a processor moves, this harness
 * throws at load rather than silently measuring nothing.** The alternative is
 * worse — the generators are not exported from any barrel, and measuring a
 * re-exported wrapper would measure the wrapper. `deps:validate` does not cover
 * `scripts/`, so this boundary crossing is invisible to it; it is recorded here
 * instead. If Yeast ever grows a barrel that exposes the processor classes,
 * switch to it.
 */
type MidiEventKind = { type: string; value?: number; note?: number };
type MidiEvent = { timeSamples: number; kind: MidiEventKind };
/**
 * Mirrors the fields of `Yeast/models/MidiEvent.ts`'s `TransportInfo` that the
 * generators actually read. Spelled out rather than left as an index signature
 * so a field renamed in the product fails to typecheck here instead of silently
 * arriving as `undefined` and being defaulted — which would turn a real drift
 * into a clean-looking zero.
 */
type TransportInfo = {
    sampleRate: number;
    bpm: number;
    blockStartSamples: number;
    blockEndSamples: number;
    ppqPosition: number;
    isPlaying: boolean;
    barIndex: number;
    beatInBar: number;
    timeSigNum: number;
    timeSigDen: number;
    loopEnabled: boolean;
    loopStartPpq: number;
    loopEndPpq: number;
};
type Generator = {
    processMidi: (input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo) => void;
    setParam: (name: string, value: number) => void;
};
type GeneratorConstructor = new (id?: string) => Generator;

const viteServer = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
    // Nothing here imports an app dependency, and the optimizer would otherwise
    // go looking for a `node_modules` that a git worktree does not have.
    optimizeDeps: { noDiscovery: true },
});

async function loadGenerator(modulePath: string, exportName: string): Promise<GeneratorConstructor> {
    const loaded = await viteServer.ssrLoadModule(modulePath);
    const candidate: unknown = loaded[exportName];
    if (typeof candidate !== 'function') {
        throw new TypeError(`${modulePath} does not export a constructor named ${exportName}`);
    }
    return candidate as GeneratorConstructor;
}

const EuclideanGenerator = await loadGenerator(
    '/src/modules/Yeast/workers/processors/EuclideanGenerator.ts',
    'EuclideanGenerator'
);
const CCGenerator = await loadGenerator('/src/modules/Yeast/workers/processors/CCGenerator.ts', 'CCGenerator');

const SAMPLE_RATE = 48_000;
const BPM = 120;
const SAMPLES_PER_BEAT = (SAMPLE_RATE * 60) / BPM;
/** EuclideanGenerator's default rate is a straight 1/16. */
const STEP_LEN_SAMPLES = (4 / 16) * SAMPLES_PER_BEAT;

function transportAt(blockStartSamples: number, blockEndSamples: number): TransportInfo {
    return {
        sampleRate: SAMPLE_RATE,
        bpm: BPM,
        blockStartSamples,
        blockEndSamples,
        ppqPosition: blockStartSamples / SAMPLES_PER_BEAT,
        isPlaying: true,
        barIndex: Math.floor(blockStartSamples / (SAMPLES_PER_BEAT * 4)),
        beatInBar: (blockStartSamples / SAMPLES_PER_BEAT) % 4,
        timeSigNum: 4,
        timeSigDen: 4,
        loopEnabled: false,
        loopStartPpq: 0,
        loopEndPpq: 0,
    };
}

type DriveInput = {
    firstBlockStartSamples: number;
    blockLengthSamples: number;
    blocks: number;
    rateDenom?: number;
};

function driveEuclidean({ firstBlockStartSamples, blockLengthSamples, blocks, rateDenom }: DriveInput): number[] {
    const generator = new EuclideanGenerator('probe');
    if (rateDenom !== undefined) {
        generator.setParam('rate_denom', rateDenom);
    }
    // Every step a hit, so the emitted times are the grid itself rather than a
    // Euclidean subset of it. The phase question is about where the grid sits.
    generator.setParam('steps', 8);
    generator.setParam('hits', 8);
    const noteOnTimes: number[] = [];
    for (let index = 0; index < blocks; index++) {
        const start = firstBlockStartSamples + index * blockLengthSamples;
        const output: MidiEvent[] = [];
        generator.processMidi([], output, transportAt(start, start + blockLengthSamples));
        for (const event of output) {
            if (event.kind.type === 'noteOn') {
                noteOnTimes.push(event.timeSamples);
            }
        }
    }
    return noteOnTimes;
}

function gridErrorSamples(time: number): number {
    const nearest = Math.round(time / STEP_LEN_SAMPLES) * STEP_LEN_SAMPLES;
    return time - nearest;
}

function samplesToMs(samples: number): number {
    return (samples / SAMPLE_RATE) * 1000;
}

function describe(label: string, values: readonly number[]): void {
    if (values.length === 0) {
        process.stdout.write(`    ${label}: no events\n`);
        return;
    }
    const absolute = values.map((value) => Math.abs(value));
    const worst = Math.max(...absolute);
    const mean = absolute.reduce((sum, value) => sum + value, 0) / absolute.length;
    process.stdout.write(
        `    ${label}: worst ${worst.toFixed(1)} samples (${samplesToMs(worst).toFixed(3)} ms), mean ${mean.toFixed(1)} samples, n=${values.length}\n`
    );
}

process.stdout.write('Yeast generator phase drift\n');
process.stdout.write('===========================\n');
process.stdout.write(`sample rate ${SAMPLE_RATE} Hz, ${BPM} BPM, straight 1/16 = ${STEP_LEN_SAMPLES} samples\n`);
process.stdout.write('budget: placement error <= 1 sample, inter-track skew = 0 samples\n');

process.stdout.write('\n--- PROBE 1: ANCHOR — two runs of the same content ---\n');
process.stdout.write('Same generator, same block cadence, first block starting at two different\n');
process.stdout.write('absolute sample positions — which is what "pressed play at a different moment"\n');
process.stdout.write('means once the block boundary is beat-derived rather than sample-aligned.\n');

const BLOCK_LENGTH = 4_800; // 100 ms of look-ahead, the product's SCHEDULE_AHEAD_SECONDS
const runA = driveEuclidean({ firstBlockStartSamples: 0, blockLengthSamples: BLOCK_LENGTH, blocks: 40 });
const runB = driveEuclidean({ firstBlockStartSamples: 1_777, blockLengthSamples: BLOCK_LENGTH, blocks: 40 });

process.stdout.write(`\n  run A — first block at sample 0\n`);
describe('offset from the absolute 1/16 grid', runA.map(gridErrorSamples));
process.stdout.write(`  run B — first block at sample 1777 (0.037 s later)\n`);
describe('offset from the absolute 1/16 grid', runB.map(gridErrorSamples));

const paired = Math.min(runA.length, runB.length);
const divergence: number[] = [];
for (let index = 0; index < paired; index++) {
    divergence.push((runB[index] ?? 0) - (runA[index] ?? 0) - 1_777);
}
process.stdout.write(`  A vs B, corrected for the ${1_777}-sample start offset\n`);
describe('run-to-run divergence for the same step index', divergence);

process.stdout.write('\n  worst-case anchor offset is bounded by one step length:\n');
process.stdout.write(
    `    ${STEP_LEN_SAMPLES} samples = ${samplesToMs(STEP_LEN_SAMPLES).toFixed(1)} ms = a whole 1/16 note at ${BPM} BPM\n`
);
process.stdout.write(`    that is ${STEP_LEN_SAMPLES.toFixed(0)}x the 1-sample budget, and it is arbitrary per run\n`);

process.stdout.write('\n--- PROBE 2: TRUNCATION — the safety<64 bound leaves phase behind ---\n');
/**
 * The widest block a live Yeast generator actually sees: the transport's
 * 100 ms look-ahead (`startPlayheadScheduler.ts:40`) plus the groove
 * look-ahead, which `getYeastSchedulingLookahead.ts:5` caps at 4 beats. This
 * is a reachable configuration, not a contrived one — the point of measuring
 * rather than reasoning is that a contrived window would prove nothing.
 */
const LOOKAHEAD_BLOCK = 0.1 * SAMPLE_RATE + 4 * SAMPLES_PER_BEAT;
const FAST_RATE_DENOM = 64;
const fastStepLen = (4 / FAST_RATE_DENOM) * SAMPLES_PER_BEAT;
const stepsDemanded = Math.floor(LOOKAHEAD_BLOCK / fastStepLen);
process.stdout.write(
    `    widest live block: 100 ms look-ahead + 4 beats groove = ${LOOKAHEAD_BLOCK} samples (${samplesToMs(LOOKAHEAD_BLOCK).toFixed(0)} ms)\n`
);
process.stdout.write(
    `    at a straight 1/${FAST_RATE_DENOM} that window demands ${stepsDemanded} steps; the loop bound is 64\n`
);
if (stepsDemanded <= 64) {
    process.stdout.write('    NOT REACHABLE at this rate — the bound is never hit, no debt accrues.\n');
} else {
    const BLOCKS = 20;
    const truncated = driveEuclidean({
        firstBlockStartSamples: 0,
        blockLengthSamples: LOOKAHEAD_BLOCK,
        blocks: BLOCKS,
        rateDenom: FAST_RATE_DENOM,
    });
    const lastEmitted = truncated[truncated.length - 1] ?? 0;
    const idealLast = BLOCKS * LOOKAHEAD_BLOCK;
    const debt = idealLast - lastEmitted;
    process.stdout.write(
        `    over ${BLOCKS} such blocks: last step emitted at sample ${lastEmitted.toFixed(0)}, window ended at ${idealLast}\n`
    );
    process.stdout.write(
        `    phase debt: ${debt.toFixed(0)} samples = ${samplesToMs(debt).toFixed(0)} ms = ${(debt / fastStepLen).toFixed(1)} steps over ${BLOCKS} blocks\n`
    );
    process.stdout.write(
        `    steps emitted ${truncated.length}, steps the grid demanded ${stepsDemanded * BLOCKS} — shortfall ${stepsDemanded * BLOCKS - truncated.length}\n`
    );
    process.stdout.write('    the debt is permanent: lastStepTime is left behind, not caught up.\n');
}

process.stdout.write('\n--- PROBE 3: ACCUMULATOR — CCGenerator over-advances per block ---\n');
process.stdout.write('accumPhase advances a whole 64-sample increment per iteration regardless of\n');
process.stdout.write('how much of the block remains. Block lengths here are beat-derived, so not\n');
process.stdout.write('multiples of 64 — which is the realistic case, not a contrived one.\n');

/** `setParam('shape', 3)` selects `sawUp` — see the shape table in CCGenerator.ts. */
const SHAPE_SAW_UP = 3;
/** A straight 1/4 — `rateToBeats` gives 1 beat, so the LFO period is one beat. */
const CC_RATE_DENOM = 4;
const CC_PERIOD_SAMPLES = SAMPLES_PER_BEAT;
/**
 * A `sawUp` ramps 0 -> 127 and drops back on each phase wrap, so a large
 * negative jump between consecutive emitted CC values localises the wrap. The
 * post-wrap value is far outside `changeThreshold`, so it is always emitted at
 * the first 64-sample boundary after the wrap: detection error is in [0, 64)
 * samples, bounded and non-accumulating. The drift being measured reaches
 * thousands of samples, so it is far outside that noise floor.
 */
const WRAP_VALUE_DROP = 60;

/** Observed wrap times, from the generator's own emitted CC events. */
function driveCcWraps(blockLengthSamples: number, blocks: number): number[] {
    const generator = new CCGenerator('probe');
    generator.setParam('shape', SHAPE_SAW_UP);
    generator.setParam('rate_denom', CC_RATE_DENOM);

    const wraps: number[] = [];
    let previousValue = -1;
    for (let index = 0; index < blocks; index++) {
        const start = index * blockLengthSamples;
        const output: MidiEvent[] = [];
        generator.processMidi([], output, transportAt(start, start + blockLengthSamples));
        for (const event of output) {
            if (event.kind.type !== 'cc' || event.kind.value === undefined) {
                continue;
            }
            const value = event.kind.value;
            if (previousValue >= 0 && previousValue - value >= WRAP_VALUE_DROP) {
                wraps.push(event.timeSamples);
            }
            previousValue = value;
        }
    }
    return wraps;
}

for (const blockLength of [4_800, 6_000, 1_777, 100]) {
    const blocks = 200;
    const wraps = driveCcWraps(blockLength, blocks);
    process.stdout.write(`    block ${String(blockLength).padStart(5)} samples x ${blocks}:\n`);
    if (wraps.length === 0) {
        process.stdout.write('      no phase wrap observed in this configuration\n');
        continue;
    }
    // Wrap N should land at N * period. The generator emits correct block times
    // and a wrong phase, so an over-advanced phase makes the wrap arrive early.
    const lastIndex = wraps.length;
    const observedLast = wraps[lastIndex - 1] ?? 0;
    const idealLast = lastIndex * CC_PERIOD_SAMPLES;
    const errorSamples = idealLast - observedLast;
    process.stdout.write(
        `      ${wraps.length} wraps observed; wrap ${lastIndex} landed at sample ${observedLast}, the tempo map puts it at ${idealLast}\n`
    );
    process.stdout.write(
        `      error ${errorSamples} samples = ${samplesToMs(errorSamples).toFixed(1)} ms = ${(errorSamples / SAMPLES_PER_BEAT).toFixed(3)} beats (early = LFO running fast)\n`
    );
}

process.stdout.write('\nAll three are deterministic. None involves a wall clock, a browser, or a\n');
process.stdout.write('machine-dependent quantity — re-running this produces the same numbers.\n');

await viteServer.close();
