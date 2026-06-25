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
            preFaderTap: ReturnType<typeof makeStripNode>;
            analyserNode: ReturnType<typeof makeStripNode>;
            meterNode: ReturnType<typeof makeStripNode> | null;
            deviceNodes: unknown[];
        };
        dispose = vi.fn();
        setGain = vi.fn();
        setPan = vi.fn();
        setMute = vi.fn();
        getPeakLevel = vi.fn().mockReturnValue(0.5);
        constructor(id: string) {
            this.trackId = id;
            this.strip = {
                trackId: id,
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

describe('AudioEngine', () => {
    let engine: AudioEngine;
    let mockCtx: MockAudioContext;

    beforeEach(() => {
        vi.clearAllMocks();
        mockCtx = createMockAudioContext();

        class FakeWorkletNode {
            port = { postMessage: vi.fn() };
            connect = vi.fn();
            disconnect = vi.fn();
        }
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
            const fb = createAudioEngine();
            // Expose the gain factory for assertions on the noop graph.
            (fb as unknown as { __createGain: Mock }).__createGain = createGain;
            return fb;
        }

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
});
