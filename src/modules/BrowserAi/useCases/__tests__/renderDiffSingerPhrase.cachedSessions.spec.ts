/**
 * Regression test for BrowserAi inventory item #13:
 *
 * renderDiffSingerPhrase used to unconditionally readModel() all five voicebank
 * sub-models + the vocoder from OPFS and loadOnnxSession-transfer 115–160 MB on
 * EVERY phrase render, even when the inference worker already held those sessions
 * in its LRU cache.
 *
 * The fix queries the worker's LIVE session cache (getLoadedOnnxSessions) and skips
 * the read + transfer for each session key already loaded — while still reading and
 * loading any key the worker does NOT report (e.g. one the LRU evicted).
 *
 * These tests prove:
 *   1. When the worker reports all six sessions loaded, readModel/loadOnnxSession are
 *      NOT called again for any of them (the re-transfer is skipped) — yet the render
 *      still runs and returns audio.
 *   2. When the worker reports nothing loaded, all six are still read + loaded.
 *   3. When the worker reports a partial set (the rest evicted), only the absent keys
 *      are read + loaded; the present ones are skipped.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks for module-level collaborators ────────────────────────────
const getLoadedOnnxSessions = vi.hoisted(() => vi.fn<() => Promise<string[]>>());
const loadOnnxSession = vi.hoisted(() => vi.fn<() => Promise<void>>());
const runDiffSingerPhrase = vi.hoisted(() => vi.fn());
const readModel = vi.hoisted(() => vi.fn());
const readRenderCache = vi.hoisted(() => vi.fn());
const writeRenderCache = vi.hoisted(() => vi.fn());
const computeRenderCacheKey = vi.hoisted(() => vi.fn<() => Promise<string>>());

vi.mock('../../repositories/inferenceWorkerBridge', () => ({
    inferenceWorkerBridge: {
        getLoadedOnnxSessions,
        loadOnnxSession,
        runDiffSingerPhrase,
    },
}));

vi.mock('../../repositories/storageManager', () => ({
    readModel,
    readRenderCache,
    writeRenderCache,
    computeRenderCacheKey,
}));

// Phonemizer + capability store are pure collaborators; stub to deterministic values.
vi.mock('../../services/phonemizer', () => ({
    phonemize: vi.fn(() => ({ tokenIds: [1, 2, 3], wordDiv: [3], wordIsSp: [false] })),
}));

vi.mock('../../stores/capabilityStore', () => ({
    capabilityStore: { value: { phase: 'idle' } },
}));

import { renderDiffSingerPhrase } from '../renderDiffSingerPhrase';

const VOICEBANK_ID = 'opencpop-test';
const ALL_SESSION_KEYS = [
    `${VOICEBANK_ID}/linguistic`,
    `${VOICEBANK_ID}/dur`,
    `${VOICEBANK_ID}/pitch`,
    `${VOICEBANK_ID}/variance`,
    `${VOICEBANK_ID}/acoustic`,
    'shared/vocoder',
];

function callRender(): ReturnType<typeof renderDiffSingerPhrase> {
    return renderDiffSingerPhrase({
        phraseId: 'phrase-1',
        voicebankId: VOICEBANK_ID,
        lyrics: 'la',
        notes: [{ pitch: 60, velocity: 100, startSec: 0, durationSec: 1 }],
        renderQuality: 'standard',
    });
}

describe('renderDiffSingerPhrase — cached-session re-read skip (item #13)', () => {
    beforeEach(() => {
        getLoadedOnnxSessions.mockReset();
        loadOnnxSession.mockReset().mockResolvedValue(undefined);
        runDiffSingerPhrase.mockReset().mockResolvedValue({
            type: 'diffsinger-result',
            requestId: 'r',
            audio: new Float32Array(44100),
        });
        // Each "model" stands in for 15–30 MB of weights; a distinct buffer per read
        // lets us assert a specific key was (not) re-read.
        readModel.mockReset().mockImplementation(() => Promise.resolve(new ArrayBuffer(8)));
        readRenderCache.mockReset().mockResolvedValue(null); // force a real render (cache miss)
        writeRenderCache.mockReset().mockResolvedValue(undefined);
        computeRenderCacheKey.mockReset().mockResolvedValue('cache-key-1');
    });

    it('skips readModel + loadOnnxSession for every session the worker already holds (no 115–160MB re-transfer)', async () => {
        // Worker reports ALL six sessions live in its cache.
        getLoadedOnnxSessions.mockResolvedValue([...ALL_SESSION_KEYS]);

        const result = await callRender();

        // The expensive path is fully skipped …
        expect(readModel).not.toHaveBeenCalled();
        expect(loadOnnxSession).not.toHaveBeenCalled();
        // … yet the render still runs against the cached sessions and returns audio.
        expect(runDiffSingerPhrase).toHaveBeenCalledTimes(1);
        expect(result.audio).toBeInstanceOf(Float32Array);
    });

    it('reads + loads all six sessions when the worker reports nothing loaded', async () => {
        getLoadedOnnxSessions.mockResolvedValue([]);

        await callRender();

        expect(readModel).toHaveBeenCalledTimes(6);
        expect(loadOnnxSession).toHaveBeenCalledTimes(6);
        const loadedKeys = loadOnnxSession.mock.calls.map((c) => (c[0] as { modelId: string }).modelId).sort();
        expect(loadedKeys).toEqual([...ALL_SESSION_KEYS].sort());
    });

    it('re-reads only the evicted session when the worker reports a partial set', async () => {
        // Worker holds five sessions live; the LRU evicted the vocoder.
        const present = ALL_SESSION_KEYS.filter((k) => k !== 'shared/vocoder');
        getLoadedOnnxSessions.mockResolvedValue(present);

        await callRender();

        // Exactly the evicted vocoder is re-read + re-loaded; the five present skip.
        expect(readModel).toHaveBeenCalledTimes(1);
        expect(loadOnnxSession).toHaveBeenCalledTimes(1);
        expect((loadOnnxSession.mock.calls[0]![0] as { modelId: string }).modelId).toBe('shared/vocoder');
    });
});
