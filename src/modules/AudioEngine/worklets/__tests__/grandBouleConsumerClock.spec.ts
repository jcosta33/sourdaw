import { describe, expect, it } from 'vitest';

import {
    GRAND_BOULE_CONSUMER_CLOCK_PUBLISHED_IDX,
    GRAND_BOULE_SYNC_INT_COUNT,
    GRAND_BOULE_SYNC_SEQUENCE_IDX,
} from '../../models/GrandBouleRingProtocol';
import { publishGrandBouleConsumerClock, readGrandBouleConsumerClock } from '../grandBouleConsumerClock';

function makeSyncInts(): Int32Array {
    return new Int32Array(new SharedArrayBuffer(GRAND_BOULE_SYNC_INT_COUNT * Int32Array.BYTES_PER_ELEMENT));
}

describe('grandBouleConsumerClock', () => {
    it('does not expose an uninitialized clock', () => {
        const target = { contextFrame: 17, readHead: 23 };

        expect(readGrandBouleConsumerClock(makeSyncInts(), target)).toBe(false);
        expect(target).toEqual({ contextFrame: 17, readHead: 23 });
    });

    it('round-trips an absolute context frame beyond Int32 and its signed read head', () => {
        const syncInts = makeSyncInts();
        const target = { contextFrame: 0, readHead: 0 };
        const contextFrame = 2 ** 31 + 12_345;

        publishGrandBouleConsumerClock(syncInts, contextFrame, -2_147_483_600);

        expect(readGrandBouleConsumerClock(syncInts, target)).toBe(true);
        expect(target).toEqual({ contextFrame, readHead: -2_147_483_600 });
    });

    it('leaves the caller cache untouched while a publication is in progress', () => {
        const syncInts = makeSyncInts();
        const target = { contextFrame: 91, readHead: 92 };
        Atomics.store(syncInts, GRAND_BOULE_CONSUMER_CLOCK_PUBLISHED_IDX, 1);
        Atomics.store(syncInts, GRAND_BOULE_SYNC_SEQUENCE_IDX, 1);

        expect(readGrandBouleConsumerClock(syncInts, target)).toBe(false);
        expect(target).toEqual({ contextFrame: 91, readHead: 92 });
    });

    it('accepts a coherent publication when the sequence counter wraps through zero', () => {
        const syncInts = makeSyncInts();
        const target = { contextFrame: 0, readHead: 0 };
        Atomics.store(syncInts, GRAND_BOULE_SYNC_SEQUENCE_IDX, -2);

        publishGrandBouleConsumerClock(syncInts, 4096, 128);

        expect(Atomics.load(syncInts, GRAND_BOULE_SYNC_SEQUENCE_IDX)).toBe(0);
        expect(readGrandBouleConsumerClock(syncInts, target)).toBe(true);
        expect(target).toEqual({ contextFrame: 4096, readHead: 128 });
    });
});
