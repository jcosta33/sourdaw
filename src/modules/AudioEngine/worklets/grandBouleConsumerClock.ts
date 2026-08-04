import {
    GRAND_BOULE_CONSUMER_CLOCK_PUBLISHED_IDX,
    GRAND_BOULE_CONSUMER_CONTEXT_HIGH_IDX,
    GRAND_BOULE_CONSUMER_CONTEXT_LOW_IDX,
    GRAND_BOULE_SYNC_READ_HEAD_IDX,
    GRAND_BOULE_SYNC_SEQUENCE_IDX,
} from '../models/GrandBouleRingProtocol';

const UINT32_RANGE = 2 ** 32;
const CONSUMER_CLOCK_READ_ATTEMPTS = 4;

export type GrandBouleConsumerClock = {
    contextFrame: number;
    readHead: number;
};

/** Publish one absolute context frame and its matching modular read head. */
export function publishGrandBouleConsumerClock(syncInts: Int32Array, contextFrame: number, readHead: number): void {
    if (!Number.isSafeInteger(contextFrame) || contextFrame < 0 || !Number.isInteger(readHead)) {
        return;
    }

    Atomics.add(syncInts, GRAND_BOULE_SYNC_SEQUENCE_IDX, 1);
    Atomics.store(syncInts, GRAND_BOULE_CONSUMER_CONTEXT_LOW_IDX, contextFrame | 0);
    Atomics.store(syncInts, GRAND_BOULE_CONSUMER_CONTEXT_HIGH_IDX, Math.floor(contextFrame / UINT32_RANGE));
    Atomics.store(syncInts, GRAND_BOULE_SYNC_READ_HEAD_IDX, readHead);
    Atomics.store(syncInts, GRAND_BOULE_CONSUMER_CLOCK_PUBLISHED_IDX, 1);
    Atomics.add(syncInts, GRAND_BOULE_SYNC_SEQUENCE_IDX, 1);
}

/** Read one coherent mapping into a caller-owned object without allocating. */
export function readGrandBouleConsumerClock(syncInts: Int32Array, target: GrandBouleConsumerClock): boolean {
    for (let attempt = 0; attempt < CONSUMER_CLOCK_READ_ATTEMPTS; attempt++) {
        const sequenceBefore = Atomics.load(syncInts, GRAND_BOULE_SYNC_SEQUENCE_IDX);
        if ((sequenceBefore & 1) !== 0) {
            continue;
        }
        if (Atomics.load(syncInts, GRAND_BOULE_CONSUMER_CLOCK_PUBLISHED_IDX) !== 1) {
            return false;
        }

        const low = Atomics.load(syncInts, GRAND_BOULE_CONSUMER_CONTEXT_LOW_IDX) >>> 0;
        const high = Atomics.load(syncInts, GRAND_BOULE_CONSUMER_CONTEXT_HIGH_IDX);
        const readHead = Atomics.load(syncInts, GRAND_BOULE_SYNC_READ_HEAD_IDX);
        const sequenceAfter = Atomics.load(syncInts, GRAND_BOULE_SYNC_SEQUENCE_IDX);
        if (sequenceBefore === sequenceAfter && (sequenceAfter & 1) === 0) {
            if (high < 0) {
                return false;
            }
            target.contextFrame = high * UINT32_RANGE + low;
            target.readHead = readHead;
            return true;
        }
    }

    return false;
}
