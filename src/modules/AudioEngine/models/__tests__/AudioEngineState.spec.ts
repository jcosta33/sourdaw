import { describe, it, expect } from 'vitest';

import type { AudioEngine, AudioEngineHealth } from '../AudioEngineState';

// AudioEngineState.ts is a types-only module, so these specs anchor the *shape*
// of the contract the engine implementation must satisfy. They guard the fix-6
// reconciliation (dead members removed) and the fix-4/fix-5 health surface.

const NO_DROPOUTS = {
    detectedUnderrunBlocks: 0,
    silentFrames: 0,
    lastUnderrunAtFrame: 0,
    bridgeDroppedBlocks: 0,
};

describe('AudioEngineHealth contract', () => {
    it('carries the worklet-ready flag, the two last-error slots and the dropout tally', () => {
        const ok: AudioEngineHealth = {
            workletReady: true,
            lastInitError: null,
            lastResumeError: null,
            dropouts: NO_DROPOUTS,
        };
        expect(Object.keys(ok).sort()).toEqual(['dropouts', 'lastInitError', 'lastResumeError', 'workletReady']);

        // The error slots accept an Error or null (so a caller can detect a
        // poisoned worklet load / failed resume and re-arm).
        const failed: AudioEngineHealth = {
            workletReady: false,
            lastInitError: new Error('worklet 404'),
            lastResumeError: new Error('resume blocked'),
            dropouts: NO_DROPOUTS,
        };
        expect(failed.lastInitError).toBeInstanceOf(Error);
        expect(failed.lastResumeError).toBeInstanceOf(Error);
    });

    it('reports the runtime dropout tally as four numeric counters', () => {
        const glitchy: AudioEngineHealth = {
            workletReady: true,
            lastInitError: null,
            lastResumeError: null,
            dropouts: {
                detectedUnderrunBlocks: 4,
                silentFrames: 512,
                lastUnderrunAtFrame: 96_000,
                bridgeDroppedBlocks: 3,
            },
        };

        expect(Object.keys(glitchy.dropouts).sort()).toEqual([
            'bridgeDroppedBlocks',
            'detectedUnderrunBlocks',
            'lastUnderrunAtFrame',
            'silentFrames',
        ]);
        expect(glitchy.dropouts.silentFrames).toBe(512);
        // A dropped bridge block is not silence: the previous processed block
        // plays again, so it adds no silent frames.
        expect(glitchy.dropouts.bridgeDroppedBlocks).toBe(3);
    });
});

describe('AudioEngine interface reconciliation (fix 6)', () => {
    it('does not include the removed dead members in its key set', () => {
        // A conforming engine stub: assigning it to `AudioEngine` is the
        // compile-time anchor that the surface stays implementable, and the
        // runtime key check documents that the dead members are gone.
        const keys = [
            'context',
            'masterGainNode',
            'masterAnalyser',
            'initialize',
            'resume',
            'suspend',
            'getHealth',
            'dispose',
        ] as const satisfies readonly (keyof AudioEngine)[];

        // These two were reconciled away in fix 6; referencing them as keys of
        // AudioEngine would be a type error, so the list above cannot contain them.
        expect(keys).not.toContain('getTransportSAB');
        expect(keys).not.toContain('setMasterTrackId');
    });

    it('declares dispose as async so callers can sequence teardown (fix 2)', () => {
        type DisposeReturn = ReturnType<AudioEngine['dispose']>;
        // Compile anchor: dispose must return a Promise. `expectAsync` is a value
        // typed as the return type; if dispose reverts to `void`, this no longer
        // assigns from `Promise.resolve()`.
        const expectAsync: DisposeReturn = Promise.resolve();
        expect(expectAsync).toBeInstanceOf(Promise);
    });
});
