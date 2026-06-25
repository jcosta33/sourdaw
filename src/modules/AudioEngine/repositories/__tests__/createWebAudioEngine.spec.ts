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
