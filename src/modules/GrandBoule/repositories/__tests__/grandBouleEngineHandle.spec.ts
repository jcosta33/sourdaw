import { describe, expect, it } from 'vitest';

import { createDisconnectedGrandBouleEngineHandle } from '../grandBouleEngineHandle';

describe('createDisconnectedGrandBouleEngineHandle', () => {
    it('returns a handle that is not ready', () => {
        const handle = createDisconnectedGrandBouleEngineHandle();
        expect(handle.isReady()).toBe(false);
    });

    it('returns null analyser node', () => {
        const handle = createDisconnectedGrandBouleEngineHandle();
        expect(handle.getAnalyserNode()).toBeNull();
    });

    it('reports a 44100 Hz sample rate', () => {
        const handle = createDisconnectedGrandBouleEngineHandle();
        expect(handle.sampleRate()).toBe(44100);
    });

    it('exposes all required methods as no-ops (calling them does not throw)', () => {
        const handle = createDisconnectedGrandBouleEngineHandle();
        expect(() => handle.noteOn({ midiNote: 60, velocity: 100 })).not.toThrow();
        expect(() => handle.noteOnMidi2({ midiNote: 60, velocity16bit: 32768, pitchOffsetQ24: 0 })).not.toThrow();
        expect(() => handle.noteOff({ midiNote: 60 })).not.toThrow();
        expect(() => handle.setParam({ name: 'master_gain', value: 0.5 })).not.toThrow();
        expect(() => handle.setSustain({ position: 1 })).not.toThrow();
        expect(() => handle.setUnaCorda({ engaged: true })).not.toThrow();
        expect(() => handle.setSostenuto({ engaged: false })).not.toThrow();
        expect(() => handle.setTemperament({ index: 1 })).not.toThrow();
        expect(() => handle.loadAttackClip({ key: 60, samples: new Float32Array(128) })).not.toThrow();
        expect(() => handle.allNotesOff()).not.toThrow();
    });
});
