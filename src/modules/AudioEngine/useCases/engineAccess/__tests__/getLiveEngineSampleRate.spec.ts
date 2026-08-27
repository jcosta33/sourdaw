import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getLiveEngineSampleRate } from '../getLiveEngineSampleRate';

const engine = vi.hoisted(() => ({
    context: { sampleRate: 96_000 } as AudioContext,
    audioAvailable: true,
}));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        get context() {
            return engine.context;
        },
        isAudioAvailable: () => engine.audioAvailable,
    },
}));

describe('getLiveEngineSampleRate', () => {
    beforeEach(() => {
        engine.context = { sampleRate: 96_000 } as AudioContext;
        engine.audioAvailable = true;
    });

    it('reports the rate the live engine renders at', () => {
        expect(getLiveEngineSampleRate()).toBe(96_000);
    });

    it('reports nothing while the engine is on its silent fallback shim', () => {
        // The shim is a real context object built at a hardcoded 44100, served
        // from the same field as a working one. Reading the field alone would
        // report that rate as though something rendered at it, and a plugin
        // activated on it stays detuned for as long as the instance lives.
        engine.context = { sampleRate: 44_100 } as AudioContext;
        engine.audioAvailable = false;

        expect(getLiveEngineSampleRate()).toBeUndefined();
    });
});
