import { describe, expect, it } from 'vitest';

import { defaultTransportState } from '../TransportState';

describe('defaultTransportState', () => {
    it('provides stopped transport with sensible tempo and time signature', () => {
        expect(defaultTransportState.isPlaying).toBe(false);
        expect(defaultTransportState.isRecording).toBe(false);
        expect(defaultTransportState.tempo).toBe(120);
        expect(defaultTransportState.timeSignatureNumerator).toBe(4);
        expect(defaultTransportState.timeSignatureDenominator).toBe(4);
        expect(defaultTransportState.playheadPosition).toBe(0);
        expect(defaultTransportState.masterGain).toBe(80);
    });

    it('defaults loop and punch to a four-bar window', () => {
        expect(defaultTransportState.loopStart).toBe(0);
        expect(defaultTransportState.loopEnd).toBe(0);
        expect(defaultTransportState.punchOutBeat).toBe(16);
    });
});
