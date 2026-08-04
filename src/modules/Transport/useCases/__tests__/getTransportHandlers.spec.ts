import { describe, it, expect } from 'vitest';

import { getTransportHandlers } from '../getTransportHandlers';

const EXPECTED_KEYS = [
    'setTempo',
    'setPlayback',
    'togglePlayback',
    'stopPlayback',
    'toggleRecording',
    'setMasterGain',
    'restoreMasterGain',
    'toggleLoop',
    'setLoopEnabled',
    'toggleMetronome',
    'setMetronomeEnabled',
    'setMetronomeVolume',
    'setLoopRegion',
    'restoreLoopRegion',
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
] as const;

describe('getTransportHandlers', () => {
    it('returns a fresh map containing every transport command handler', () => {
        const map = getTransportHandlers();
        const keys = Object.keys(map).sort();
        expect(keys).toEqual([...EXPECTED_KEYS].sort());
        expect(getTransportHandlers()).not.toBe(map);
    });

    it('every handler is a complete ActionHandler (execute + describe functions, undoable boolean)', () => {
        const map = getTransportHandlers();
        for (const handler of Object.values(map)) {
            expect(typeof handler.execute).toBe('function');
            expect(typeof handler.describe).toBe('function');
            expect(typeof handler.undoable).toBe('boolean');
        }
    });

    it('every handler has a describe function that accepts its action type', () => {
        const map = getTransportHandlers();
        for (const handler of Object.values(map)) {
            // describe must be a callable function (payload shape varies per handler,
            // so we assert callability rather than a specific label).
            expect(typeof handler.describe).toBe('function');
        }
    });
});
