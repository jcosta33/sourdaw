/**
 * The wasm leg of the per-quantum cost table, running inside a real
 * `AudioWorkletGlobalScope`.
 *
 * Why it has to be here and not on the main thread: production renders this
 * wasm in a worklet, and a worklet is not a page. It has no DOM, a separate V8
 * isolate with its own compilation of the same module, and — the part that
 * keeps catching people — no `TextDecoder`/`TextEncoder`, which is why the glue
 * imported here is the *polyfilled* copy under `src/modules/AudioEngine/wasm/`
 * rather than the raw wasm-pack output under `public/wasm/`. Both are committed
 * artifacts; nothing is rebuilt to take these numbers.
 *
 * One device quantum per `process()` call, so the measured call sits on the
 * same code path, in the same scope, at the same cadence production drives it.
 *
 * **One device per context.** The page builds a fresh `OfflineAudioContext` per
 * table row, so each device warms up and is measured in an otherwise empty
 * worklet. That is the *favourable* case for cache residency — a real session
 * has a dozen of these competing for L2 — so every figure here is a lower
 * bound on what the same device costs inside a full mix.
 *
 * The host is an `OfflineAudioContext`, which has no deadline, so this measures
 * **cost** and cannot observe a dropout. That distinction belongs to AC-3, not
 * to this file; the bench header states it.
 */

import { initSync as initDsp, BacteriaInstance, CrumbsInstance, CrustInstance, FermenterInstance, GlutenInstance, GrinderInstance, KneadInstance, LevainInstance, ProofInstance, ToasterInstance } from '/src/modules/AudioEngine/wasm/daw_dsp.js';
import { initSync as initChamber, ProofChamberInstance } from '/src/modules/AudioEngine/wasm/proof_chamber.js';
import { initSync as initScoring, ScoringInstance } from '/src/modules/AudioEngine/wasm/scoring.js';

import { buildDevices, QUANTUM } from './deviceRecipes.js';
// The real shipped audio-thread code, type-stripped by the harness server, so
// the ring-consumer row times the function production runs.
import * as ring from '/src/modules/AudioEngine/models/GrandBouleRingProtocol.ts';
import { publishGrandBouleConsumerClock } from '/src/modules/AudioEngine/worklets/grandBouleConsumerClock.ts';
import { readBlockAcquire } from '/src/modules/AudioEngine/worklets/grandBouleProcessor.ts';

/**
 * The distribution of "read the clock twice with nothing in between", in ticks.
 *
 * This is the harness's own cost, and it is inside every device figure: each
 * `Atomics.load` is a coherence miss against the line the tick worker is
 * writing. Measured here rather than assumed negligible, and reported as its
 * own row so a 20 us device is not read as if the floor were zero.
 */
function measureHarnessFloor(ticks, samples) {
    const floor = new Float64Array(samples);
    for (let i = 0; i < samples; i += 1) {
        const before = Atomics.load(ticks, 0);
        const after = Atomics.load(ticks, 0);
        floor[i] = (after - before) | 0;
    }
    return floor;
}

class QuantumCostProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const config = options.processorOptions;
        this._done = false;

        if (typeof SharedArrayBuffer === 'undefined' || typeof Atomics === 'undefined') {
            this.port.postMessage({
                type: 'fatal',
                message:
                    'neither performance.now() nor SharedArrayBuffer is available in this ' +
                    'AudioWorkletGlobalScope, so no per-quantum wall-clock figure can be taken inside a ' +
                    'worklet on this browser. Report the wasm leg as unavailable — do not substitute a ' +
                    'main-thread number for it.',
            });
            this._done = true;
            return;
        }

        this._ticks = new Int32Array(config.clockBuffer);

        const dspExports = initDsp({ module: new WebAssembly.Module(config.dspBytes) });
        const chamberExports = initChamber({ module: new WebAssembly.Module(config.chamberBytes) });
        const scoringExports = initScoring({ module: new WebAssembly.Module(config.scoringBytes) });

        // 2000 is plenty to characterise two clock reads, and keeps thirteen
        // rows' worth of retained samples off the renderer's heap.
        this._harnessFloorTicks = measureHarnessFloor(this._ticks, 2_000);
        this._warmupQuanta = config.warmupQuanta;
        this._measureQuanta = config.measureQuanta;

        // Build inside a try, and post the real message.
        //
        // `AudioWorkletNode.onprocessorerror` carries no diagnostic — the host
        // gets `${deviceId}: the worklet processor threw` and nothing else. That
        // cost an hour on the first device added after this file was written:
        // `CrustInstance` was missing from the import list above, so
        // `dsp.CrustInstance` was `undefined`, and the only symptom available
        // was that the processor threw. An instrument whose failure mode is
        // "something went wrong" is not finished equipment.
        let built;
        try {
            built = buildDevices({
            only: config.deviceId,
            // Every quantum this row will render, warm-up included. A recipe
            // that has to lay out a timeline ahead of time sizes it from this
            // rather than from a literal, so raising `--measure` cannot walk a
            // row off the end of its own data.
            quantaBudget: config.warmupQuanta + config.measureQuanta,
            dsp: {
                memory: dspExports.memory,
                BacteriaInstance,
                CrumbsInstance,
                CrustInstance,
                FermenterInstance,
                GlutenInstance,
                GrinderInstance,
                KneadInstance,
                LevainInstance,
                ProofInstance,
                ToasterInstance,
            },
            chamber: { memory: chamberExports.memory, ProofChamberInstance },
            scoring: { memory: scoringExports.memory, ScoringInstance },
            ring,
            publishGrandBouleConsumerClock,
            readBlockAcquire,
            });
        } catch (error) {
            this.port.postMessage({
                type: 'fatal',
                message:
                    `building device "${config.deviceId}" threw: ${error && error.message ? error.message : String(error)}. ` +
                    'If the message names an undefined constructor, the class is missing from the ' +
                    'import list at the top of this file — that list is written by hand and does not ' +
                    'follow the crate.',
            });
            this._done = true;
            return;
        }
        const [device] = built;
        if (!device) {
            this.port.postMessage({
                type: 'fatal',
                message:
                    `no recipe produced a device for "${config.deviceId}". It is in DEVICE_IDS but ` +
                    'deviceRecipes.js has no matching `wanted(...)` block, so this row would have ' +
                    'been silently absent from the table rather than failing.',
            });
            this._done = true;
            return;
        }
        this._device = device;

        this._phase = 'warmup';
        this._counter = 0;
        this._frame = 0;
        this._samples = new Float64Array(this._measureQuanta);
        this._startedAtMs = Date.now();

        // In-window calibration.
        //
        // The previous version calibrated the tick rate **once before and once
        // after the whole run** and published the difference as a drift figure.
        // That figure carries no information about the error it was offered as
        // a proxy for: a reproduction of this mechanism in Node — same V8, same
        // scheduler, where `performance.now()` exists to check against —
        // reported +0.59% drift on a run whose median was off by +8.6% and
        // whose p95 was off by +12.4%, and +14.10% drift on a run at a load
        // *below* the ceiling. Drift and accuracy are uncorrelated.
        //
        // So the rate is now measured **inside** the timed window, in segments,
        // against the worklet's own `Date.now()`. Each sample is converted with
        // the rate of the segment it was taken in, and the spread of those
        // per-segment rates is published per row — a real dispersion figure
        // instead of one before/after pair. A segment is long enough that
        // `Date.now()`'s 1 ms granularity contributes well under a percent.
        this._segmentTargetMs = config.segmentTargetMs;
        this._segmentRates = [];
        this._segmentIndex = new Int32Array(this._measureQuanta);
        this._segmentStartMs = 0;
        this._segmentStartTick = 0;
        this._warmVerify = null;
        /** Kept and posted so nothing in the render chain is dead code. */
        this._sink = 0;
        /** Last discarded warm-up sample, posted for the same reason. */
        this._discarded = 0;
        /** Summed warm-up ticks, so the wall-clock cross-check can account for them. */
        this._warmupTicks = 0;
        this._warmupTotalTicks = 0;
        /**
         * Samples whose tick delta came back zero.
         *
         * This is the one way contention can make a sample read *shorter* than
         * the truth, and it has to be counted rather than assumed away. The
         * clock is a counter another thread increments; if that thread is
         * descheduled for the whole of a render, the counter does not move and
         * the render reads as zero. Everything else contention does adds time.
         * A non-trivial count here means the floor below is being dragged down
         * by clock stalls rather than by the device being fast, which is why
         * the published floor is a low percentile and not the raw minimum.
         */
        this._zeroTickSamples = 0;
        /** Wall clock of the timed pass only, for the load attribution window. */
        this._timedStartedAtMs = 0;
    }

    process() {
        if (this._done) {
            return false;
        }

        const device = this._device;
        if (device.feed !== undefined) {
            device.feed(this._frame);
        }
        this._frame += 1;

        // The warm-up runs the *identical* body to the timed pass, clock reads
        // included, and throws its samples away. Warming up through a cheaper
        // loop than the one being measured warms the DSP but not the loop: the
        // native leg did that at first and every row's first 500 timed samples
        // came out 20-60% above its own median.
        const ticks = this._ticks;
        const before = Atomics.load(ticks, 0);
        const produced = device.render();
        const after = Atomics.load(ticks, 0);
        // Consume the render's return value so neither V8 nor the wasm engine
        // can treat the call as dead. `_sink` is posted back with the results.
        this._sink += produced;
        // `| 0` so the counter wrapping past 2^31 stays a correct small delta.
        const elapsedTicks = (after - before) | 0;

        if (this._phase === 'warmup') {
            this._discarded = elapsedTicks;
            this._warmupTicks += elapsedTicks;
            this._counter += 1;
            if (this._counter >= this._warmupQuanta) {
                this._warmVerify = device.verify();
                this._phase = 'measure';
                this._counter = 0;
                this._warmupTotalTicks = this._warmupTicks;
                this._timedStartedAtMs = Date.now();
                this._segmentStartMs = Date.now();
                this._segmentStartTick = Atomics.load(ticks, 0);
            }
            return true;
        }

        if (elapsedTicks === 0) {
            this._zeroTickSamples += 1;
        }
        this._samples[this._counter] = elapsedTicks;
        this._segmentIndex[this._counter] = this._segmentRates.length;
        this._counter += 1;

        // Close the segment once it has covered enough wall clock for
        // `Date.now()`'s 1 ms granularity to be negligible against it.
        const nowMs = Date.now();
        const segmentMs = nowMs - this._segmentStartMs;
        if (segmentMs >= this._segmentTargetMs) {
            const segmentTicks = (after - this._segmentStartTick) | 0;
            this._segmentRates.push(segmentTicks / segmentMs);
            this._segmentStartMs = nowMs;
            this._segmentStartTick = after;
        }

        if (this._counter >= this._measureQuanta) {
            const tailMs = Date.now() - this._segmentStartMs;
            if (tailMs > 0) {
                this._segmentRates.push((((after - this._segmentStartTick) | 0)) / tailMs);
            }
            this.port.postMessage({
                type: 'result',
                id: device.id,
                label: device.label,
                note: device.note,
                harnessFloorTicks: this._harnessFloorTicks,
                quantum: QUANTUM,
                warmupQuanta: this._warmupQuanta,
                measureQuanta: this._measureQuanta,
                warmVerify: this._warmVerify,
                lateVerify: device.verify(),
                sink: this._sink,
                lastDiscardedWarmupTicks: this._discarded,
                warmupTotalTicks: this._warmupTotalTicks,
                zeroTickSamples: this._zeroTickSamples,
                timedStartedAtMs: this._timedStartedAtMs,
                timedFinishedAtMs: Date.now(),
                segmentRates: this._segmentRates,
                segmentIndex: this._segmentIndex,
                segmentTargetMs: this._segmentTargetMs,
                // Wall clock across warm-up + the timed run, from the worklet's
                // own `Date.now()`. An independent upper bound on the sum of
                // the tick-derived samples: if the calibrated total exceeds
                // this, the tick rate is wrong.
                wallClockMs: Date.now() - this._startedAtMs,
                samplesTicks: this._samples,
            });
            this._done = true;
            return false;
        }
        return true;
    }
}

registerProcessor('quantum-cost', QuantumCostProcessor);
