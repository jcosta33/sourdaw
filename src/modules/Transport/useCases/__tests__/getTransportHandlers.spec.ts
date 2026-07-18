import { describe, it, expect } from 'vitest';

import { getTransportHandlers } from '../getTransportHandlers';

describe('getTransportHandlers', () => {
    it('returns a fresh map containing every transport command handler', () => {
        const map = getTransportHandlers();
        for (const key of [
            'setTempo',
            'togglePlayback',
            'stopPlayback',
            'toggleRecording',
            'toggleLoop',
            'toggleMetronome',
            'setMetronomeVolume',
            'setLoopRegion',
            'seekPlayhead',
            'setPunchIn',
            'setPunchOut',
            'restorePunchRegion',
            'togglePunch',
            'toggleCountIn',
            'setCountInBars',
            'setTimeSignature',
            'addTimeSignatureChange',
            'removeTimeSignatureChange',
            'togglePreRoll',
            'setPreRollBars',
        ] as const) {
            expect(map[key]).toBeDefined();
            expect(map[key].execute).toBeDefined();
        }
        expect(getTransportHandlers()).not.toBe(map);
    });
});
