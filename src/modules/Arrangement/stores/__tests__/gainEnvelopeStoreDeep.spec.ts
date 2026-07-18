import { describe, it, expect, beforeEach } from 'vitest';

import {
    gainEnvelopeStore,
    getEnvelope,
    setEnvelope,
    getAllEnvelopes,
    removeEnvelope,
    __resetGainEnvelopesForTest,
    type ClipGainEnvelope,
} from '../gainEnvelopeStore';

const make_env = (clipId: string): ClipGainEnvelope => ({
    clipId,
    points: [{ id: 'p1', beatOffset: 0, gainDb: 0 }],
    enabled: true,
});

describe('gainEnvelopeStore', () => {
    beforeEach(() => __resetGainEnvelopesForTest());

    it('getEnvelope returns undefined for unknown clip', () => {
        expect(getEnvelope('nonexistent')).toBeUndefined();
    });

    it('setEnvelope stores envelope', () => {
        const env = make_env('c1');
        setEnvelope('c1', env);
        expect(getEnvelope('c1')).toBe(env);
    });

    it('setEnvelope overwrites existing', () => {
        setEnvelope('c1', make_env('c1'));
        const updated: ClipGainEnvelope = { clipId: 'c1', points: [], enabled: false };
        setEnvelope('c1', updated);
        expect(getEnvelope('c1')).toBe(updated);
    });

    it('getAllEnvelopes returns all stored envelopes', () => {
        setEnvelope('c1', make_env('c1'));
        setEnvelope('c2', make_env('c2'));
        const all = getAllEnvelopes();
        expect(all).toHaveLength(2);
    });

    it('getAllEnvelopes returns empty for no state', () => {
        expect(getAllEnvelopes()).toEqual([]);
    });

    it('removeEnvelope removes by clipId', () => {
        setEnvelope('c1', make_env('c1'));
        setEnvelope('c2', make_env('c2'));
        removeEnvelope('c1');
        expect(getEnvelope('c1')).toBeUndefined();
        expect(getEnvelope('c2')).toBeDefined();
    });

    it('removeEnvelope is no-op for unknown clipId', () => {
        setEnvelope('c1', make_env('c1'));
        removeEnvelope('nonexistent');
        expect(getEnvelope('c1')).toBeDefined();
    });

    it('store subscription fires on set', () => {
        let called = false;
        const unsub = gainEnvelopeStore.subscribe(() => {
            called = true;
        });
        setEnvelope('c1', make_env('c1'));
        expect(called).toBe(true);
        unsub();
    });
});
