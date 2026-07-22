import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { createMockAudioContext, type MockAudioContext } from '../../../../helpers/__tests__/audioContext.mock';
import { createAudioEngine } from '../createWebAudioEngine';

import type { AudioEngine } from '../../models/AudioEngineState';

// Mock TrackNode and BusNode to avoid deep dependencies. The strip exposes the
// nodes that AudioEngineImpl reads directly (preFaderTap / analyserNode for
// sends and sidechain, deviceNodes for note-off fan-out, meterNode for the
// dispose shutdown sweep) so the engine's own routing logic is exercised.
function makeStripNode() {
    return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        port: { postMessage: vi.fn(), close: vi.fn() },
    };
}

vi.mock('../../engine/TrackNode', () => ({
    TrackNode: class {
        trackId: string;
        strip: {
            trackId: string;
            gainNode: ReturnType<typeof makeStripNode>;
            preFaderTap: ReturnType<typeof makeStripNode>;
            analyserNode: ReturnType<typeof makeStripNode>;
            meterNode: ReturnType<typeof makeStripNode> | null;
            deviceNodes: unknown[];
            outputId?: string;
        };
        private deps: {
            masterGainNode: unknown;
            getTrackGainNode: (trackId: string) => unknown;
        };
        dispose = vi.fn();
        setGain = vi.fn();
        setPan = vi.fn();
        setMute = vi.fn();
        setOutput = vi.fn((outputId: string) => {
            this.strip.outputId = outputId;
            this.strip.analyserNode.disconnect();
            const destination = outputId === 'hw_out' ? this.deps.masterGainNode : this.deps.getTrackGainNode(outputId);
            this.strip.analyserNode.connect(destination ?? this.deps.masterGainNode);
        });
        getPeakLevel = vi.fn().mockReturnValue(0.5);
        constructor(
            id: string,
            deps: {
                masterGainNode: unknown;
                getTrackGainNode: (trackId: string) => unknown;
            }
        ) {
            this.trackId = id;
            this.deps = deps;
            this.strip = {
                trackId: id,
                gainNode: makeStripNode(),
                preFaderTap: makeStripNode(),
                analyserNode: makeStripNode(),
                meterNode: makeStripNode(),
                deviceNodes: [],
            };
        }
    },
}));

vi.mock('../../engine/BusNode', () => ({
    BusNode: class {
        busId: string;
        strip: { busId: string; gainNode: { connect: Mock } };
        dispose = vi.fn();
        setGain = vi.fn();
        getPeakLevel = vi.fn().mockReturnValue(0.3);
        constructor(id: string) {
            this.busId = id;
            this.strip = { busId: id, gainNode: { connect: vi.fn() } };
        }
    },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

/**
 * The engine constructor signature wants a real `AudioContext`; the mock matches
 * its surface structurally but not nominally. Funnel the conversion through one
 * typed helper so the test bodies work against the real `AudioEngine` interface
 * rather than `any` (the value under test stays fully typed at the call site).
 */
function asAudioContext(ctx: MockAudioContext): AudioContext {
    return ctx as unknown as AudioContext;
}

function makeFallbackEngine(): AudioEngine {
    class FailingAudioContext {
        constructor() {
            throw new Error('no AudioContext in this environment');
        }
    }
    const createGain = vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() }));
    vi.stubGlobal('AudioContext', FailingAudioContext);
    vi.stubGlobal(
        'OfflineAudioContext',
        class {
            createGain = createGain;
            createAnalyser() {
                return { connect: vi.fn(), disconnect: vi.fn(), frequencyBinCount: 1 };
            }
        }
    );
    const fallbackEngine = createAudioEngine();
    // Expose the gain factory for assertions on the noop graph.
    (fallbackEngine as unknown as { __createGain: Mock }).__createGain = createGain;
    return fallbackEngine;
}

function getPendingSidechainRoutes(engine: AudioEngine): Map<string, unknown> {
    return (engine as unknown as { pendingSidechainRoutes: Map<string, unknown> }).pendingSidechainRoutes;
}

describe('AudioEngine', () => {
    let engine: AudioEngine;
    let mockCtx: MockAudioContext;

    class FakeWorkletNode {
        port = { postMessage: vi.fn() };
        connect = vi.fn();
        disconnect = vi.fn();
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mockCtx = createMockAudioContext();

        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        vi.stubGlobal(
            'SharedArrayBuffer',
            class extends ArrayBuffer {
                constructor(length: number) {
                    super(length);
                }
            }
        );

        engine = createAudioEngine(asAudioContext(mockCtx));
    });

    it('should initialize with master nodes', () => {
        expect(engine.context).toBeDefined();
        expect(engine.masterGainNode).toBeDefined();
        expect(engine.masterAnalyser).toBeDefined();
        expect(mockCtx.createGain).toHaveBeenCalled();
        expect(mockCtx.createAnalyser).toHaveBeenCalled();
    });

    it('should load worklets on initialize', async () => {
        await engine.initialize();
        expect(mockCtx.audioWorklet.addModule).toHaveBeenCalledTimes(5);
    });

    it('should manage master gain', () => {
        engine.setMasterGain(0.5);
        expect(engine.masterGainNode.gain.setTargetAtTime).toHaveBeenCalledWith(0.5, expect.any(Number), 0.01);

        engine.masterGainNode.gain.value = 0.5;
        expect(engine.getMasterGain()).toBe(0.5);
    });

    it('should ensure and remove track strips', () => {
        const strip = engine.ensureTrackStrip('t1');
        expect(strip.trackId).toBe('t1');

        const retrieved = engine.getTrackStrip('t1');
        expect(retrieved).toBe(strip);

        void engine.removeTrackStrip('t1');
        expect(engine.getTrackStrip('t1')).toBeUndefined();
    });

    it('should handle master peak level', () => {
        const peak = engine.getMasterPeakLevel();
        expect(typeof peak).toBe('number');
    });

    // ── Fix 1: removeTrackStrip sweeps dependent send/sidechain entries ──────────
    describe('removeTrackStrip dependent-route sweep', () => {
        it('reroutes every inbound track output to the master destination', () => {
            const inboundA = engine.ensureTrackStrip('inbound-a');
            const inboundB = engine.ensureTrackStrip('inbound-b');
            engine.ensureTrackStrip('target');
            engine.setTrackOutput('inbound-a', 'target');
            engine.setTrackOutput('inbound-b', 'target');

            engine.removeTrackStrip('target');

            expect(inboundA.outputId).toBe('hw_out');
            expect(inboundB.outputId).toBe('hw_out');
            expect(inboundA.analyserNode.connect).toHaveBeenLastCalledWith(engine.masterGainNode);
            expect(inboundB.analyserNode.connect).toHaveBeenLastCalledWith(engine.masterGainNode);
        });

        it('disconnects and forgets the source track sends when the track is removed', () => {
            engine.ensureTrackStrip('src');
            engine.setSend('src', 'busA', 0.5);
            engine.setSend('src', 'busB', 0.5);

            // The two send GainNodes are the createGain() calls made by setSend.
            const sendGains = mockCtx.createGain.mock.results
                .map((r) => r.value as { disconnect: Mock })
                .filter((node) => node.disconnect.mock.calls.length === 0);
            const sendCountBefore = sendGains.length;
            expect(sendCountBefore).toBeGreaterThanOrEqual(2);

            engine.removeTrackStrip('src');

            // Re-creating a send to the same key proves the old entry was swept:
            // a leaked entry would be reused (setTargetAtTime path) instead of
            // building a fresh GainNode.
            const createGainCallsBeforeReSend = mockCtx.createGain.mock.calls.length;
            engine.ensureTrackStrip('src');
            engine.setSend('src', 'busA', 0.7);
            const createGainCallsAfterReSend = mockCtx.createGain.mock.calls.length;
            expect(createGainCallsAfterReSend).toBeGreaterThan(createGainCallsBeforeReSend);
        });

        it('clamps the initial gain of a brand-new send to [0,1] (Observation 10)', () => {
            engine.ensureTrackStrip('clampSrc');

            // A fresh send with an out-of-range level. The create path must apply
            // the same [0,1] clamp the update path uses — not the raw level.
            engine.setSend('clampSrc', 'busHi', 1.5);
            const overGain = mockCtx.createGain.mock.results.at(-1)!.value as { gain: { value: number } };
            expect(overGain.gain.value).toBe(1);

            engine.setSend('clampSrc', 'busLo', -0.5);
            const underGain = mockCtx.createGain.mock.results.at(-1)!.value as { gain: { value: number } };
            expect(underGain.gain.value).toBe(0);
        });

        it('disconnects the source track sidechain gain when the track is removed', () => {
            // Wire a sidechain whose target device is a sidechain compressor.
            const srcStrip = engine.ensureTrackStrip('scSrc');
            const tgtStrip = engine.ensureTrackStrip('scTgt');
            const deviceInput = makeStripNode();
            tgtStrip.deviceNodes.push({
                deviceId: 'dev1',
                type: 'builtin-sidechain-compressor',
                inputNode: deviceInput as unknown as AudioNode,
            } as never);

            engine.wireSidechainRoute('scSrc', 'scTgt', 'dev1');

            // The sidechain GainNode is the most recent createGain() result.
            const scGain = mockCtx.createGain.mock.results.at(-1)!.value as { disconnect: Mock };
            expect(scGain.disconnect).not.toHaveBeenCalled();

            engine.removeTrackStrip('scSrc');
            expect(scGain.disconnect).toHaveBeenCalled();

            // Re-wiring proves the entry was deleted (no early `has(key)` return).
            engine.ensureTrackStrip('scSrc');
            const createGainBefore = mockCtx.createGain.mock.calls.length;
            engine.wireSidechainRoute('scSrc', 'scTgt', 'dev1');
            expect(mockCtx.createGain.mock.calls.length).toBeGreaterThan(createGainBefore);

            void srcStrip;
        });

        it('disconnects a sidechain targeting a removed device and permits rewiring the same route key', () => {
            engine.ensureTrackStrip('scSrc');
            const targetStrip = engine.ensureTrackStrip('scTgt');
            targetStrip.deviceNodes.push({
                deviceId: 'dev1',
                type: 'builtin-sidechain-compressor',
                inputNode: makeStripNode() as unknown as AudioNode,
            } as never);
            engine.wireSidechainRoute('scSrc', 'scTgt', 'dev1');
            const oldSidechainGain = mockCtx.createGain.mock.results.at(-1)!.value as { disconnect: Mock };

            engine.removeTrackStrip('scTgt');

            expect(oldSidechainGain.disconnect).toHaveBeenCalledTimes(1);
            const replacementTarget = engine.ensureTrackStrip('scTgt');
            replacementTarget.deviceNodes.push({
                deviceId: 'dev1',
                type: 'builtin-sidechain-compressor',
                inputNode: makeStripNode() as unknown as AudioNode,
            } as never);
            const createGainBeforeRewire = mockCtx.createGain.mock.calls.length;
            engine.wireSidechainRoute('scSrc', 'scTgt', 'dev1');
            expect(mockCtx.createGain.mock.calls.length).toBe(createGainBeforeRewire + 1);
        });

        it('forgets pending sidechains owned by a removed source, target track, or target device', () => {
            const fallbackEngine = makeFallbackEngine();
            const removedStrip = fallbackEngine.ensureTrackStrip('removed');
            removedStrip.deviceNodes.push({ deviceId: 'owned-device' } as never);

            fallbackEngine.wireSidechainRoute('removed', 'other-target', 'other-device');
            fallbackEngine.wireSidechainRoute('other-source-a', 'removed', 'missing-device');
            fallbackEngine.wireSidechainRoute('other-source-b', 'wrong-target', 'owned-device');
            fallbackEngine.wireSidechainRoute('kept-source', 'kept-target', 'kept-device');
            expect(getPendingSidechainRoutes(fallbackEngine).size).toBe(4);

            fallbackEngine.removeTrackStrip('removed');

            expect(Array.from(getPendingSidechainRoutes(fallbackEngine).keys())).toEqual(['kept-source→kept-device']);
        });
    });

    // ── Fix 4: a rejected addModule must not poison initialize() forever ─────────
    describe('worklet load is retryable', () => {
        it('does not cache a rejection and surfaces lastInitError, then succeeds on retry', async () => {
            mockCtx.audioWorklet.addModule.mockRejectedValueOnce(new Error('404 worklet'));

            await expect(engine.initialize()).rejects.toThrow('404 worklet');
            expect(engine.getHealth().lastInitError?.message).toContain('404 worklet');
            expect(engine.getHealth().workletReady).toBe(false);

            // Next attempt re-runs the load (the poisoned promise was cleared).
            await expect(engine.initialize()).resolves.toBeUndefined();
            expect(engine.getHealth().workletReady).toBe(true);
            expect(engine.getHealth().lastInitError).toBeNull();
        });

        it('shares one in-flight load across concurrent callers', async () => {
            const callsBefore = mockCtx.audioWorklet.addModule.mock.calls.length;
            await Promise.all([engine.initialize(), engine.initialize()]);
            const callsAfter = mockCtx.audioWorklet.addModule.mock.calls.length;
            // Five modules loaded exactly once despite two callers.
            expect(callsAfter - callsBefore).toBe(5);
        });
    });

    // ── Fix 5: resume() must surface failure, not catch-and-resolve ──────────────
    describe('resume failure handling', () => {
        it('rejects and records lastResumeError when the context resume rejects', async () => {
            mockCtx.state = 'suspended';
            mockCtx.resume.mockRejectedValueOnce(new Error('resume blocked'));

            await expect(engine.resume()).rejects.toThrow('resume blocked');
            expect(engine.getHealth().lastResumeError?.message).toContain('resume blocked');
        });

        it('clears lastResumeError on a subsequent successful resume', async () => {
            mockCtx.state = 'suspended';
            mockCtx.resume.mockRejectedValueOnce(new Error('resume blocked'));
            await expect(engine.resume()).rejects.toThrow();

            mockCtx.state = 'suspended';
            mockCtx.resume.mockResolvedValueOnce(undefined);
            await expect(engine.resume()).resolves.toBeUndefined();
            expect(engine.getHealth().lastResumeError).toBeNull();
        });
    });

    // ── Fix 2: dispose() teardown contract ───────────────────────────────────────
    describe('dispose', () => {
        it('awaits context.close, resets the worklet latch, and releases the transport SAB', async () => {
            await engine.initialize();
            expect(engine.getHealth().workletReady).toBe(true);

            await engine.dispose();

            expect(mockCtx.close).toHaveBeenCalledTimes(1);
            expect(engine.getHealth().workletReady).toBe(false);

            // SAB released: a post-dispose transport write must not throw.
            expect(() => engine.setTransportInfo(1, 120, true)).not.toThrow();

            // initPromise reset: a re-initialize reloads the worklet modules.
            const addModuleCallsBefore = mockCtx.audioWorklet.addModule.mock.calls.length;
            await engine.initialize();
            expect(mockCtx.audioWorklet.addModule.mock.calls.length).toBe(addModuleCallsBefore + 5);
        });

        it('posts a shutdown message to live track worklet ports before teardown', async () => {
            const strip = engine.ensureTrackStrip('t1');
            const meterPort = (strip.meterNode as unknown as { port: { postMessage: Mock } }).port;

            await engine.dispose();

            expect(meterPort.postMessage).toHaveBeenCalledWith({ type: 'shutdown' });
        });
    });

    // ── Round-2 #6: setTransportInfo publishes a seqlock-guarded snapshot ─────────
    //
    // The transport SAB is shared with a worklet reader (kneadProcessor). Writing
    // the seven f64 fields with plain assignments lets a reader observe a snapshot
    // torn across the writes. setTransportInfo must instead bracket the field
    // writes with a sequence counter (Int32 view) bumped odd-before / even-after,
    // so a reader retrying on odd/changed counters never consumes a torn snapshot.
    describe('setTransportInfo seqlock (torn-read guard)', () => {
        // Int32 index of the seqlock counter; mirrors TRANSPORT_SEQ_I32 in the impl
        // and TRANSPORT_SEQ_I32 in services/kneadProcessor.ts.
        const SEQ_I32 = 14;
        const F64 = { beat: 0, tempo: 1, sampleRate: 2, loopStart: 3, loopEnd: 4, isPlaying: 5, isLooping: 6 };

        // The engine allocates its own transport SAB internally. We recover it by
        // spying on the Int32Array the constructor wraps over that buffer (the seq
        // view), then read the data fields through a Float64Array over the same
        // buffer — exactly the two views the writer and the worklet reader share.
        let capturedBuffer: ArrayBufferLike | null = null;
        function captureTransportBuffer(): ArrayBufferLike {
            expect(capturedBuffer).not.toBeNull();
            return capturedBuffer!;
        }
        let OriginalInt32Array: typeof Int32Array;

        beforeEach(() => {
            OriginalInt32Array = Int32Array;
            capturedBuffer = null;
            // Capture the buffer the engine wraps with its seq Int32Array. The
            // engine constructs Float64Array first, then Int32Array, over the same
            // SAB; we record the buffer from the Int32Array construction.
            class SpyInt32Array extends OriginalInt32Array {
                constructor(...args: unknown[]) {
                    // @ts-expect-error spread into the typed-array constructor
                    super(...args);
                    // The transport SAB is the only 64-byte buffer the constructor
                    // wraps with an Int32Array; ignore any other typed-array builds.
                    if (args[0] instanceof ArrayBuffer && args[0].byteLength === 64) {
                        capturedBuffer = args[0];
                    }
                }
            }
            vi.stubGlobal('Int32Array', SpyInt32Array);
            engine = createAudioEngine(asAudioContext(mockCtx));
            vi.stubGlobal('Int32Array', OriginalInt32Array);
        });

        it('leaves the sequence counter even after a completed write and advances it by 2', () => {
            const buf = captureTransportBuffer();
            expect(buf).not.toBeNull();
            const seq = new Int32Array(buf);

            const before = Atomics.load(seq, SEQ_I32);
            engine.setTransportInfo(4, 130, true, 1, 5, true);
            const after = Atomics.load(seq, SEQ_I32);

            // Even after the write completes (write-in-progress is the odd state).
            expect(after % 2).toBe(0);
            // Advanced by exactly 2 (odd, then even) — one full seqlock cycle.
            expect(after - before).toBe(2);
        });

        it('publishes every field value under the settled (even) counter', () => {
            const buf = captureTransportBuffer();
            const seq = new Int32Array(buf);
            const data = new Float64Array(buf);

            engine.setTransportInfo(2.5, 90, false, 8, 16, true);

            // All seven fields carry the values passed, and the counter is settled
            // even — the combination a reader requires for a trusted snapshot.
            expect(data[F64.beat]).toBe(2.5);
            expect(data[F64.tempo]).toBe(90);
            expect(data[F64.sampleRate]).toBe(mockCtx.sampleRate);
            expect(data[F64.loopStart]).toBe(8);
            expect(data[F64.loopEnd]).toBe(16);
            expect(data[F64.isPlaying]).toBe(0);
            expect(data[F64.isLooping]).toBe(1);
            expect(Atomics.load(seq, SEQ_I32) % 2).toBe(0);
        });

        it('the engine writer produces snapshots a seqlock reader accepts as clean', () => {
            // Faithful re-implementation of the reader loop in
            // services/kneadProcessor.ts (TRANSPORT_SEQ_MAX_RETRIES path): sample
            // the fields between two Atomics.load of the counter; accept only when
            // the counter is unchanged and even. After a completed engine write the
            // reader must get the exact values on its first attempt — proving the
            // writer's seqlock output is consumable, not torn.
            const buf = captureTransportBuffer();
            const seq = new Int32Array(buf);
            const data = new Float64Array(buf);

            function seqlockRead(): { beat: number; tempo: number; playing: boolean; cleanFirstTry: boolean } {
                let beat = 0;
                let tempo = 120;
                let playing = false;
                let cleanFirstTry = false;
                for (let attempt = 0; attempt <= 8; attempt++) {
                    const start = Atomics.load(seq, SEQ_I32);
                    beat = data[F64.beat] ?? 0;
                    tempo = data[F64.tempo] ?? 120;
                    playing = (data[F64.isPlaying] ?? 0) > 0.5;
                    const end = Atomics.load(seq, SEQ_I32);
                    if (start === end && (start & 1) === 0) {
                        cleanFirstTry = attempt === 0;
                        break;
                    }
                }
                return { beat, tempo, playing, cleanFirstTry };
            }

            const seqBeforeWrites = Atomics.load(seq, SEQ_I32);

            engine.setTransportInfo(42, 128, true, 0, 0, false);
            const r1 = seqlockRead();
            expect(r1.cleanFirstTry).toBe(true);
            expect(r1.beat).toBe(42);
            expect(r1.tempo).toBe(128);
            expect(r1.playing).toBe(true);

            engine.setTransportInfo(7, 100, false, 0, 0, false);
            const r2 = seqlockRead();
            expect(r2.cleanFirstTry).toBe(true);
            expect(r2.beat).toBe(7);
            expect(r2.tempo).toBe(100);
            expect(r2.playing).toBe(false);

            // Each write must advance the seqlock counter by exactly 2 (odd→even):
            // without the protocol the counter never moves and a concurrent reader
            // has no way to detect a torn write. Two writes ⇒ +4.
            expect(Atomics.load(seq, SEQ_I32) - seqBeforeWrites).toBe(4);
        });

        it('a seqlock reader rejects a mid-write (odd-counter) snapshot as torn', () => {
            // The reader's torn-detection logic in isolation, on a buffer the test
            // fully controls (so the engine's sole-writer parity invariant is not
            // disturbed). When the counter is odd — the in-progress state the writer
            // holds between its odd and even bumps — the reader must never break out
            // accepting the snapshot, even after exhausting its retry bound.
            const standalone = new ArrayBuffer(64);
            const seq = new Int32Array(standalone);
            const data = new Float64Array(standalone);

            // Mid-write: odd counter, a torn/partial field value.
            Atomics.store(seq, SEQ_I32, 1);
            data[F64.beat] = 999;

            let accepted = false;
            for (let attempt = 0; attempt <= 8; attempt++) {
                const start = Atomics.load(seq, SEQ_I32);
                const _beat = data[F64.beat] ?? 0;
                void _beat;
                const end = Atomics.load(seq, SEQ_I32);
                if (start === end && (start & 1) === 0) {
                    accepted = true;
                    break;
                }
            }
            expect(accepted).toBe(false);

            // Once the write completes (counter bumped to the next even value), the
            // same reader accepts the now-consistent snapshot.
            Atomics.store(seq, SEQ_I32, 2);
            data[F64.beat] = 12;
            let cleanBeat = 0;
            for (let attempt = 0; attempt <= 8; attempt++) {
                const start = Atomics.load(seq, SEQ_I32);
                cleanBeat = data[F64.beat] ?? 0;
                const end = Atomics.load(seq, SEQ_I32);
                if (start === end && (start & 1) === 0) {
                    break;
                }
            }
            expect(cleanBeat).toBe(12);
        });
    });

    // ── Round-2 #8: device/param methods no-op in fallback mode ───────────────────
    //
    // In fallbackMode the engine runs on an OfflineAudioContext/noop shim. The
    // device + MIDI-FX methods previously built nodes on that shim instead of
    // no-opping like the already-guarded methods. They must short-circuit on
    // `if (this.fallbackMode) return` so no graph work happens on the shim.
    describe('fallbackMode device-method guards', () => {
        let fbEngine: AudioEngine;

        beforeEach(() => {
            // Force the constructor's AudioContext path to throw → fallbackMode.
            // setupNoopContext then builds the engine on an OfflineAudioContext.
            class FailingAudioContext {
                constructor() {
                    throw new Error('no AudioContext in this environment');
                }
            }
            vi.stubGlobal('AudioContext', FailingAudioContext);
            vi.stubGlobal(
                'OfflineAudioContext',
                class {
                    createGain() {
                        return { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
                    }
                    createAnalyser() {
                        return { connect: vi.fn(), disconnect: vi.fn(), frequencyBinCount: 1 };
                    }
                }
            );
            // No providedContext → ctor tries `new AudioContext(...)`, which throws.
            fbEngine = createAudioEngine();
        });

        it('reports fallback state (engine did not get a live context)', () => {
            expect(fbEngine.getState().isReady).toBe(false);
            expect(fbEngine.getState().state).toBe('closed');
        });

        it('addDeviceToStrip does not build a track node on the shim in fallback mode', () => {
            // A guarded no-op means no strip is ever materialized for the track.
            fbEngine.addDeviceToStrip('t1', 'dev1', 'builtin-gain');
            expect(fbEngine.getTrackStrip('t1')).toBeUndefined();
        });

        it('device + MIDI-FX param methods do not forward to a strip in fallback mode', () => {
            // Materialize a strip on the shim (ensureTrackStrip is outside the
            // guarded device-method scope, so it still creates one in fallback).
            // The mock TrackNode deliberately lacks updateParam/addDevice/etc., so
            // an UNGUARDED method that forwards to the strip throws a TypeError.
            // A correctly guarded method returns before touching the strip → no
            // throw. This is the regression signal: each method must short-circuit.
            fbEngine.ensureTrackStrip('t1');
            expect(fbEngine.getTrackStrip('t1')).toBeDefined();

            expect(() => fbEngine.updateDeviceParam('t1', 'dev1', 'p', 0.5)).not.toThrow();
            expect(() => fbEngine.updateDevicePatch('t1', 'dev1', { p: 1 })).not.toThrow();
            expect(() => fbEngine.removeDeviceFromStrip('t1', 'dev1')).not.toThrow();
            expect(() => fbEngine.scheduleDeviceParam('t1', 'dev1', 'p', 0.5, 0)).not.toThrow();
            expect(() => fbEngine.scheduleDeviceKeyOn('t1', 'dev1', 60, 100)).not.toThrow();
            expect(() => fbEngine.scheduleDeviceKeyOff('t1', 'dev1', 60, 100)).not.toThrow();
            expect(() => fbEngine.updateDeviceBypass('t1', 'dev1', true)).not.toThrow();
            expect(() => fbEngine.addMidiFxToStrip('t1', 'fx1', 'arp')).not.toThrow();
            expect(() => fbEngine.removeMidiFxFromStrip('t1', 'fx1')).not.toThrow();
            expect(() => fbEngine.updateMidiFxParam('t1', 'fx1', 'p', 0.5)).not.toThrow();
            expect(() => fbEngine.updateMidiFxBypass('t1', 'fx1', true)).not.toThrow();
        });
    });

    it('does not allocate a strip when parameter and patch executors target an absent strip', () => {
        const engine = createAudioEngine();

        expect(engine.getTrackStrip('missing-track')).toBeUndefined();

        engine.updateDeviceParam('missing-track', 'missing-device', 'gain', 0.5);
        engine.updateDevicePatch('missing-track', 'missing-device', { gain: 0.75 });

        expect(engine.getTrackStrip('missing-track')).toBeUndefined();
    });

    // ── Fix 2: sidechain wiring in fallback mode is queued, not dropped ──────────
    //
    // wireSidechainRoute used to early-return in fallback mode, silently dropping
    // the route while the store kept it — diverging the live graph with no
    // recovery. It now queues the route (without touching the noop graph) for
    // replay on the next non-fallback wire, while unwire cancels a still-pending
    // route. These tests guard the observable engine-side behavior: fallback
    // wiring must not crash or corrupt the noop graph, and the ready path must
    // keep wiring as before. The discriminating queue-vs-drop + recoverable-state
    // contract is proven through the public caller in setSidechainRoutes.spec.ts.
    describe('sidechain fallback queue and replay', () => {
        it('does not wire onto the noop graph and does not throw when requested in fallback mode', () => {
            const fb = makeFallbackEngine();
            const createGain = (fb as unknown as { __createGain: Mock }).__createGain;
            // setupNoopContext builds one gain node (master). Wiring a sidechain
            // must not build another — the route is queued, not applied.
            const gainCallsAfterSetup = createGain.mock.calls.length;

            expect(() => fb.wireSidechainRoute('src', 'dst', 'dev1')).not.toThrow();
            expect(createGain.mock.calls.length).toBe(gainCallsAfterSetup);

            // Unwire of a still-pending route is a clean no-op (cancels the queue).
            expect(() => fb.unwireSidechainRoute('src', 'dev1')).not.toThrow();
        });

        it('still wires a valid route on a ready engine (replay-drain is harmless when empty)', () => {
            const tgtStrip = engine.ensureTrackStrip('scTgt');
            engine.ensureTrackStrip('scSrc');
            tgtStrip.deviceNodes.push({
                deviceId: 'dev1',
                type: 'builtin-sidechain-compressor',
                inputNode: makeStripNode() as unknown as AudioNode,
            } as never);

            const createGainBefore = mockCtx.createGain.mock.calls.length;
            engine.wireSidechainRoute('scSrc', 'scTgt', 'dev1');
            // A new sidechain GainNode was built and wired (the path still runs).
            expect(mockCtx.createGain.mock.calls.length).toBeGreaterThan(createGainBefore);

            const scGain = mockCtx.createGain.mock.results.at(-1)!.value as { connect: Mock };
            expect(scGain.connect).toHaveBeenCalled();
        });
    });

    // ── PR #312: sidechain replay is idempotent and drops unresolvable routes ────
    //
    // wireSidechainRoutes (Routing) replays every persisted route on each
    // ensureTrackStrips run — before every playback/record start — so the engine
    // paths it exercises must be safe to re-run: a route that is already wired
    // must not double-connect (the `sidechainConnections.has(key)` dedupe), and
    // a route whose target strip/device does not exist must be dropped without
    // throwing (applySidechainRoute's guards), never crashing strip setup.
    describe('sidechain replay idempotency and missing-target drop', () => {
        function pushSidechainDevice(targetStrip: { deviceNodes: unknown[] }, deviceId: string) {
            targetStrip.deviceNodes.push({
                deviceId,
                type: 'builtin-sidechain-compressor',
                inputNode: makeStripNode() as unknown as AudioNode,
            });
        }

        it('wiring the same route twice creates exactly one sidechain connection', () => {
            const tgtStrip = engine.ensureTrackStrip('scTgt');
            const srcStrip = engine.ensureTrackStrip('scSrc');
            pushSidechainDevice(tgtStrip, 'dev1');

            const createGainBefore = mockCtx.createGain.mock.calls.length;
            engine.wireSidechainRoute('scSrc', 'scTgt', 'dev1');
            // First wire builds exactly one sidechain GainNode off the source tap.
            expect(mockCtx.createGain.mock.calls.length).toBe(createGainBefore + 1);
            const connectCallsAfterFirst = (srcStrip.analyserNode.connect as Mock).mock.calls.length;

            // Replay (second wire of the identical route) must hit the
            // `sidechainConnections.has(key)` dedupe: no new GainNode, no new
            // connection off the source tap — a pure no-op.
            engine.wireSidechainRoute('scSrc', 'scTgt', 'dev1');
            expect(mockCtx.createGain.mock.calls.length).toBe(createGainBefore + 1);
            expect((srcStrip.analyserNode.connect as Mock).mock.calls.length).toBe(connectCallsAfterFirst);
        });

        it('drops a route whose target strip is absent without throwing or building nodes', () => {
            engine.ensureTrackStrip('scSrc');

            const createGainBefore = mockCtx.createGain.mock.calls.length;
            expect(() => engine.wireSidechainRoute('scSrc', 'missing-target', 'dev1')).not.toThrow();
            expect(mockCtx.createGain.mock.calls.length).toBe(createGainBefore);
        });

        it('drops a route whose source strip is absent without throwing or building nodes', () => {
            const tgtStrip = engine.ensureTrackStrip('scTgt');
            pushSidechainDevice(tgtStrip, 'dev1');

            const createGainBefore = mockCtx.createGain.mock.calls.length;
            expect(() => engine.wireSidechainRoute('missing-source', 'scTgt', 'dev1')).not.toThrow();
            expect(mockCtx.createGain.mock.calls.length).toBe(createGainBefore);
        });

        it('drops a route whose target device is absent (or not a sidechain compressor) without throwing', () => {
            engine.ensureTrackStrip('scSrc');
            const tgtStrip = engine.ensureTrackStrip('scTgt');

            // No device at all on the target strip.
            const createGainBefore = mockCtx.createGain.mock.calls.length;
            expect(() => engine.wireSidechainRoute('scSrc', 'scTgt', 'missing-dev')).not.toThrow();
            expect(mockCtx.createGain.mock.calls.length).toBe(createGainBefore);

            // A device with the right id but the wrong type is also rejected.
            tgtStrip.deviceNodes.push({
                deviceId: 'not-a-compressor',
                type: 'builtin-gain',
                inputNode: makeStripNode() as unknown as AudioNode,
            } as never);
            expect(() => engine.wireSidechainRoute('scSrc', 'scTgt', 'not-a-compressor')).not.toThrow();
            expect(mockCtx.createGain.mock.calls.length).toBe(createGainBefore);
        });
    });

    // ── Fix 3: pre/post-fader send-tap toggle crossfades (no silence gap) ────────
    //
    // Toggling a live send between the pre- and post-fader tap used to hard
    // disconnect() the send gain and then connect() the new tap across two
    // synchronous Web Audio calls — leaving the bus with no input for one render
    // quantum (~2.7ms), an audible drop on a pumping bus. The toggle must now
    // equal-time-crossfade: build a fresh gain on the new tap ramping 0→level
    // while the old gain ramps level→0 over the same ~10ms window, so the bus is
    // continuously fed, and only tear the old node down after the ramp.
    describe('pre/post-fader send-tap crossfade', () => {
        function setupSend(): { disconnect: Mock; gain: { linearRampToValueAtTime: Mock } } {
            engine.ensureTrackStrip('t1');
            engine.setSend('t1', 'busA', 0.5, /* preFader */ false);
            return mockCtx.createGain.mock.results.at(-1)!.value as {
                disconnect: Mock;
                gain: { linearRampToValueAtTime: Mock };
            };
        }

        it('does not hard-disconnect the old send gain synchronously on a tap toggle', () => {
            vi.useFakeTimers();
            try {
                const firstSendGain = setupSend();
                expect(firstSendGain.disconnect).not.toHaveBeenCalled();

                // Toggle post → pre.
                engine.setSend('t1', 'busA', 0.5, /* preFader */ true);

                // The old gain must NOT be torn down in the same tick — it is
                // ramped to silence and disconnected only after the crossfade.
                expect(firstSendGain.disconnect).not.toHaveBeenCalled();
                // It ramps down to 0 (the outgoing half of the crossfade).
                expect(firstSendGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
            } finally {
                vi.useRealTimers();
            }
        });

        it('builds a new gain on the incoming tap that ramps up from 0 to the level', () => {
            vi.useFakeTimers();
            try {
                setupSend();
                const createGainCallsBefore = mockCtx.createGain.mock.calls.length;

                engine.setSend('t1', 'busA', 0.5, /* preFader */ true);

                // A fresh gain node was built for the incoming tap.
                expect(mockCtx.createGain.mock.calls.length).toBe(createGainCallsBefore + 1);
                const newGain = mockCtx.createGain.mock.results.at(-1)!.value as {
                    connect: Mock;
                    gain: { setValueAtTime: Mock; linearRampToValueAtTime: Mock };
                };
                // Incoming half of the crossfade: start at 0, ramp up to level.
                expect(newGain.gain.setValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
                expect(newGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, expect.any(Number));
                // The new gain is wired into the bus, so the bus is fed during the fade.
                expect(newGain.connect).toHaveBeenCalled();
            } finally {
                vi.useRealTimers();
            }
        });

        it('tears the old send gain down only after the crossfade window elapses', () => {
            vi.useFakeTimers();
            try {
                const firstSendGain = setupSend();

                engine.setSend('t1', 'busA', 0.5, /* preFader */ true);
                expect(firstSendGain.disconnect).not.toHaveBeenCalled();

                // Advance past the crossfade + teardown margin (10ms + 20ms).
                vi.advanceTimersByTime(40);
                expect(firstSendGain.disconnect).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('still ramps the level in place when the tap does not change (no crossfade)', () => {
            engine.ensureTrackStrip('t2');
            engine.setSend('t2', 'busB', 0.4, /* preFader */ false);
            const sendGain = mockCtx.createGain.mock.results.at(-1)!.value as {
                gain: { setTargetAtTime: Mock };
            };
            const createGainCallsBefore = mockCtx.createGain.mock.calls.length;

            // Same preFader: a level change must NOT build a new node (no crossfade).
            engine.setSend('t2', 'busB', 0.9, /* preFader */ false);

            expect(mockCtx.createGain.mock.calls.length).toBe(createGainCallsBefore);
            expect(sendGain.gain.setTargetAtTime).toHaveBeenCalledWith(0.9, expect.any(Number), 0.01);
        });
    });

    // ── Fix 6: dead interface members are gone ───────────────────────────────────
    describe('interface reconciliation', () => {
        it('no longer exposes the dead getTransportSAB method (it had zero callers)', () => {
            expect((engine as Record<string, unknown>).getTransportSAB).toBeUndefined();
        });

        it('does not surface the never-implemented setMasterTrackId method', () => {
            // It was declaration-only on the interface (no implementation, no
            // caller), so it was never a real method at runtime. This asserts it
            // stays absent on the concrete engine.
            expect((engine as Record<string, unknown>).setMasterTrackId).toBeUndefined();
        });
    });

    // ── Fix 1: master peak path is wired through a SAB-backed meter ───────────────
    //
    // Before, getMasterPeakLevel always returned 0: masterMeterBuffer was a plain
    // Float32Array nothing wrote to, and no metering-processor sat in the master
    // chain (masterGain → masterAnalyser → destination). initialize() must insert
    // a SAB-backed metering-processor (masterGain → meter → analyser) and point
    // masterMeterBuffer at that SAB, so getMasterPeakLevel reflects real level.
    describe('master meter wiring', () => {
        function masterMeterSab(eng: AudioEngine): ArrayBuffer {
            const meterNode = (eng as unknown as { masterMeterNode: { port: { postMessage: Mock } } }).masterMeterNode;
            const initCall = meterNode.port.postMessage.mock.calls.find(
                (c) => (c[0] as { type?: string })?.type === 'init'
            );
            expect(initCall).toBeDefined();
            return (initCall![0] as { sab: ArrayBuffer }).sab;
        }

        it('inserts a metering-processor into the master chain on initialize', async () => {
            // Before init, no meter node is wired (master nodes are built in the
            // constructor, before any worklet module is loaded).
            const beforeInit = (engine as unknown as { masterMeterNode?: unknown }).masterMeterNode;
            expect(beforeInit).toBeUndefined();

            await engine.initialize();

            const meterNode = (engine as unknown as { masterMeterNode: { connect: Mock } }).masterMeterNode;
            expect(meterNode).toBeDefined();
            // Master gain rerouted: disconnected from the analyser, then connected
            // to the meter, which connects to the analyser.
            expect(engine.masterGainNode.disconnect).toHaveBeenCalled();
            expect(engine.masterGainNode.connect as Mock).toHaveBeenCalledWith(meterNode);
            expect(meterNode.connect).toHaveBeenCalledWith(engine.masterAnalyser);
        });

        it('reports the peak the meter writes into the SAB, then resets it', async () => {
            await engine.initialize();
            const sab = masterMeterSab(engine);
            // Exactly one Float32 (the single combined-peak slot).
            expect(sab.byteLength).toBe(4);

            // Simulate the worklet writing a peak the UI then reads.
            new Float32Array(sab)[0] = 0.6;
            expect(engine.getMasterPeakLevel()).toBeCloseTo(0.6, 5);
            // Read-and-reset: a second read with no new write returns 0.
            expect(engine.getMasterPeakLevel()).toBe(0);
        });
    });

    // ── Fix 4: stopAllScheduled sends one allNotesOff per synth, not a fan-out ────
    //
    // It used to post 128 noteOff per Fermenter and 16 per Toaster in one
    // synchronous loop. Both processors now honor a single allNotesOff worklet
    // message, so stopAllScheduled must post exactly one {type:'allNotesOff'} to
    // each device's worklet node port.
    describe('stopAllScheduled all-notes-off', () => {
        function pushSynth(eng: AudioEngine, trackId: string, controlsKey: string) {
            const strip = eng.ensureTrackStrip(trackId);
            const workletNode = new FakeWorkletNode();
            strip.deviceNodes.push({
                deviceId: `${controlsKey}-dev`,
                type: controlsKey,
                nodes: [workletNode],
                [controlsKey]: { noteOff: vi.fn() },
            } as never);
            return workletNode;
        }

        it('posts a single allNotesOff to Fermenter and Toaster worklet ports', () => {
            const fermNode = pushSynth(engine, 'tFerm', 'fermenterControls');
            const toastNode = pushSynth(engine, 'tToast', 'toasterControls');

            engine.stopAllScheduled();

            const fermAllOff = fermNode.port.postMessage.mock.calls.filter(
                (c) => (c[0] as { type?: string })?.type === 'allNotesOff'
            );
            const toastAllOff = toastNode.port.postMessage.mock.calls.filter(
                (c) => (c[0] as { type?: string })?.type === 'allNotesOff'
            );
            expect(fermAllOff.length).toBe(1);
            expect(toastAllOff.length).toBe(1);

            // And NOT a fan-out of per-note noteOff messages.
            const fermNoteOffs = fermNode.port.postMessage.mock.calls.filter(
                (c) => (c[0] as { type?: string })?.type === 'noteOff'
            );
            expect(fermNoteOffs.length).toBe(0);
        });

        it('releases Grand Boule through its control-level allNotesOff contract', () => {
            const allNotesOff = vi.fn();
            const strip = engine.ensureTrackStrip('tGrandBoule');
            strip.deviceNodes.push({
                deviceId: 'grand-boule-dev',
                type: 'grand-boule',
                nodes: [],
                grandBouleControls: { allNotesOff },
            } as never);

            engine.stopAllScheduled();

            expect(allNotesOff).toHaveBeenCalledTimes(1);
        });
    });

    // ── findToasterControls: deviceId-keyed port for foreign modules (Toaster) ────
    //
    // Owns the strip/device-node traversal so Toaster resolves a loaded device's
    // control surface without touching getTrackStrip(...).deviceNodes internals.
    describe('findToasterControls', () => {
        function pushDevice(eng: AudioEngine, trackId: string, deviceId: string, withControls: boolean) {
            const strip = eng.ensureTrackStrip(trackId);
            const controls = withControls ? { setParam: vi.fn(), setPadParam: vi.fn() } : undefined;
            strip.deviceNodes.push({
                deviceId,
                type: withControls ? 'toaster' : 'builtin-eq',
                nodes: [],
                ...(controls ? { toasterControls: controls } : {}),
            } as never);
            return controls;
        }

        it('selects the matching device by deviceId across multiple tracks and devices', () => {
            pushDevice(engine, 'tA', 'eq-1', false);
            const controlsB = pushDevice(engine, 'tB', 'toast-b', true);
            pushDevice(engine, 'tB', 'eq-2', false);
            const controlsC = pushDevice(engine, 'tC', 'toast-c', true);

            expect(engine.findToasterControls('toast-b')).toBe(controlsB);
            expect(engine.findToasterControls('toast-c')).toBe(controlsC);
        });

        it('returns undefined for a missing device or a device without toaster controls', () => {
            pushDevice(engine, 'tA', 'eq-1', false);

            expect(engine.findToasterControls('nope')).toBeUndefined();
            // deviceId exists but carries no toasterControls surface.
            expect(engine.findToasterControls('eq-1')).toBeUndefined();
        });
    });

    // ── Fix 6: the transport SAB allocation is guarded by hasSharedArrayBuffer ────
    //
    // The module-level singleton constructs the engine at import time. The
    // transport SAB allocation sat outside the constructor try/catch with no
    // capability guard, so `new SharedArrayBuffer(64)` threw at import on a page
    // without COOP+COEP. Construction must not throw when SAB is unavailable, and
    // setTransportInfo must no-op rather than write into a null view.
    describe('transport SAB capability guard', () => {
        it('constructs without throwing when SharedArrayBuffer is unavailable', () => {
            const savedSAB = globalThis.SharedArrayBuffer;
            // Remove the global the way a non-isolated page would.
            delete (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer;
            try {
                let noSabEngine: AudioEngine | undefined;
                expect(() => {
                    noSabEngine = createAudioEngine(asAudioContext(mockCtx));
                }).not.toThrow();
                // Transport writes are a safe no-op with no SAB backing.
                expect(() => noSabEngine!.setTransportInfo(4, 120, true)).not.toThrow();
            } finally {
                vi.stubGlobal('SharedArrayBuffer', savedSAB);
            }
        });
    });
});
