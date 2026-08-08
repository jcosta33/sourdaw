import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    actionHistoryMetadataPort,
    setActionHistoryMetadataPort,
    type ActionHistoryMetadata,
} from '../actionHistoryMetadataPort';

const sampleEntry: ActionHistoryMetadata = {
    id: 'entry-1',
    label: 'Add track',
    actionKind: 'track.add',
    source: 'manual',
    timestamp: 1000,
    reverted: false,
};

describe('actionHistoryMetadataPort', () => {
    afterEach(() => {
        // Reset to the default no-op port after each test.
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
    });

    describe('default no-op port', () => {
        it('record returns an empty array and does not throw', () => {
            const result = actionHistoryMetadataPort.record(sampleEntry);

            expect(result).toEqual([]);
        });

        it('markReverted returns {status: "unavailable"}', () => {
            const result = actionHistoryMetadataPort.markReverted({ entryId: 'x', expectedFingerprint: 'fp' });

            expect(result).toEqual({ status: 'unavailable' });
        });

        it('clear is a no-op (does not throw)', () => {
            expect(() => actionHistoryMetadataPort.clear()).not.toThrow();
        });
    });

    describe('swappable port', () => {
        it('delegates record to the swapped implementation and returns its result', () => {
            const recordFn = vi.fn(() => ['fp-a', 'fp-b']);
            setActionHistoryMetadataPort({
                record: recordFn,
                markReverted: () => ({ status: 'unavailable' }),
                clear: () => undefined,
            });

            const result = actionHistoryMetadataPort.record(sampleEntry);

            expect(recordFn).toHaveBeenCalledWith(sampleEntry);
            expect(result).toEqual(['fp-a', 'fp-b']);
        });

        it('delegates markReverted to the swapped implementation with the input', () => {
            const markFn = vi.fn(() => ({ status: 'marked' as const }));
            setActionHistoryMetadataPort({
                record: () => [],
                markReverted: markFn,
                clear: () => undefined,
            });

            const result = actionHistoryMetadataPort.markReverted({ entryId: 'e1', expectedFingerprint: 'fp' });

            expect(markFn).toHaveBeenCalledWith({ entryId: 'e1', expectedFingerprint: 'fp' });
            expect(result).toEqual({ status: 'marked' });
        });

        it('delegates clear to the swapped implementation', () => {
            const clearFn = vi.fn();
            setActionHistoryMetadataPort({
                record: () => [],
                markReverted: () => ({ status: 'unavailable' }),
                clear: clearFn,
            });

            actionHistoryMetadataPort.clear();

            expect(clearFn).toHaveBeenCalledTimes(1);
        });

        it('a second swap replaces the first (no accumulation)', () => {
            const firstRecord = vi.fn(() => ['first']);
            const secondRecord = vi.fn(() => ['second']);
            setActionHistoryMetadataPort({
                record: firstRecord,
                markReverted: () => ({ status: 'unavailable' }),
                clear: () => undefined,
            });
            setActionHistoryMetadataPort({
                record: secondRecord,
                markReverted: () => ({ status: 'unavailable' }),
                clear: () => undefined,
            });

            const result = actionHistoryMetadataPort.record(sampleEntry);

            expect(firstRecord).not.toHaveBeenCalled();
            expect(secondRecord).toHaveBeenCalledWith(sampleEntry);
            expect(result).toEqual(['second']);
        });
    });
});
