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

import { initSync as initDsp, BacteriaInstance, CrumbsInstance, FermenterInstance, GlutenInstance, GrandBouleInstance, GrinderInstance, KneadInstance, LevainInstance, ProofInstance, ToasterInstance } from '/src/modules/AudioEngine/wasm/daw_dsp.js';
import { initSync as initChamber, ProofChamberInstance } from '/src/modules/AudioEngine/wasm/proof_chamber.js';
import { initSync as initScoring, ScoringInstance } from '/src/modules/AudioEngine/wasm/scoring.js';

import { buildDevices, QUANTUM } from './deviceRecipes.js';

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

        this._harnessFloorTicks = measureHarnessFloor(this._ticks, 20_000);
        this._warmupQuanta = config.warmupQuanta;
        this._measureQuanta = config.measureQuanta;

        const [device] = buildDevices({
            only: config.deviceId,
            dsp: {
                memory: dspExports.memory,
                BacteriaInstance,
                CrumbsInstance,
                FermenterInstance,
                GlutenInstance,
                GrandBouleInstance,
                GrinderInstance,
                KneadInstance,
                LevainInstance,
                ProofInstance,
                ToasterInstance,
            },
            chamber: { memory: chamberExports.memory, ProofChamberInstance },
            scoring: { memory: scoringExports.memory, ScoringInstance },
        });
        this._device = device;

        this._phase = 'warmup';
        this._counter = 0;
        this._frame = 0;
        this._samples = new Float64Array(this._measureQuanta);
        this._startedAtMs = Date.now();
        this._warmVerify = null;
        /** Kept and posted so nothing in the render chain is dead code. */
        this._sink = 0;
        /** Last discarded warm-up sample, posted for the same reason. */
        this._discarded = 0;
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
            this._counter += 1;
            if (this._counter >= this._warmupQuanta) {
                this._warmVerify = device.verify();
                this._phase = 'measure';
                this._counter = 0;
            }
            return true;
        }

        this._samples[this._counter] = elapsedTicks;
        this._counter += 1;

        if (this._counter >= this._measureQuanta) {
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
