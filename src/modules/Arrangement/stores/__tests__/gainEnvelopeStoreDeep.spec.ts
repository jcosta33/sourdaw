import { describe, it, expect, beforeEach } from 'vitest';

import {
    gainEnvelopeStore,
    getEnvelope,
    setEnvelope,
    getAllEnvelopes,
    removeEnvelope,
    sanitizeClipGainEnvelopes,
    setAllEnvelopes,
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

    it('getAllEnvelopes returns empty when the store value is null', () => {
        gainEnvelopeStore.set(null);

        expect(getAllEnvelopes()).toEqual([]);
    });

    it('setEnvelope re-seeds from the default when the store value is null', () => {
        gainEnvelopeStore.set(null);

        const env = make_env('c1');
        setEnvelope('c1', env);

        expect(getEnvelope('c1')).toBe(env);
    });

    it('removeEnvelope re-seeds from the default and no-ops when the store value is null', () => {
        gainEnvelopeStore.set(null);

        // Should not throw and should leave the store in a valid state
        removeEnvelope('c1');

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

    it('setAllEnvelopes replaces the whole map rather than merging into it', () => {
        setEnvelope('c1', make_env('c1'));

        setAllEnvelopes({ c2: make_env('c2') });

        expect(getEnvelope('c1')).toBeUndefined();
        expect(getEnvelope('c2')?.clipId).toBe('c2');
    });

    describe('sanitizeClipGainEnvelopes', () => {
        it('rekeys a persisted list by clipId and copies each point', () => {
            const persisted = [{ clipId: 'c1', enabled: true, points: [{ id: 'p1', beatOffset: 2, gainDb: -6 }] }];

            const decoded = sanitizeClipGainEnvelopes(persisted);

            expect(decoded).toEqual({
                c1: { clipId: 'c1', enabled: true, points: [{ id: 'p1', beatOffset: 2, gainDb: -6 }] },
            });
            expect(decoded.c1?.points[0]).not.toBe(persisted[0]?.points[0]);
        });

        it('drops envelopes whose points could not be read', () => {
            const decoded = sanitizeClipGainEnvelopes([
                { clipId: 'c-bad', enabled: true, points: [{ id: 'p1', beatOffset: 0, gainDb: 'loud' }] },
                { clipId: 'c-good', enabled: false, points: [] },
            ]);

            expect(Object.keys(decoded)).toEqual(['c-good']);
            expect(decoded['c-good']?.enabled).toBe(false);
        });

        it('decodes a non-array to no envelopes', () => {
            expect(sanitizeClipGainEnvelopes(undefined)).toEqual({});
            expect(sanitizeClipGainEnvelopes({ envelopes: {} })).toEqual({});
        });
    });
});
