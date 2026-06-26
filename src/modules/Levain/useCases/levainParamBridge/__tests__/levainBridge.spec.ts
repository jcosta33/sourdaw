import { describe, it, expect } from 'vitest';

import { levainBridge } from '../levainBridge';

describe('levainBridge', () => {
    it('resolves to a singleton bridge — repeated calls return the same instance', () => {
        const first = levainBridge();
        const second = levainBridge();

        expect(first).toBe(second);
    });

    it('exposes the bridge method surface', () => {
        const bridge = levainBridge();

        expect(typeof bridge.registerLevainDevice).toBe('function');
        expect(typeof bridge.unregisterLevainDevice).toBe('function');
        expect(typeof bridge.loadSamplesForInstrument).toBe('function');
        expect(typeof bridge.setLevainParamWithAudio).toBe('function');
        expect(typeof bridge.setMacroWithAudio).toBe('function');
        expect(typeof bridge.sendMicParamToEngine).toBe('function');
    });
});
