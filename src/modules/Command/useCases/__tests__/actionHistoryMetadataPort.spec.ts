import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ActionHistoryMetadata } from '../actionHistoryMetadataPort';

type PortModule = typeof import('../actionHistoryMetadataPort');

const sampleEntry: ActionHistoryMetadata = {
    id: 'entry-1',
    label: 'Add track',
    actionKind: 'track.add',
    source: 'manual',
    timestamp: 1000,
    reverted: false,
};

const REGISTRAR = 'setActionHistoryMetadataPort() from registerCorePorts() in src/app/bootstrap.ts';

describe('actionHistoryMetadataPort', () => {
    let port: PortModule['actionHistoryMetadataPort'];
    let setPort: PortModule['setActionHistoryMetadataPort'];

    beforeEach(async () => {
        // A fresh module graph holds an unfilled port; the shared spec fixture only fills the first one.
        vi.resetModules();
        const module = await import('../actionHistoryMetadataPort');
        port = module.actionHistoryMetadataPort;
        setPort = module.setActionHistoryMetadataPort;
    });

    describe('read before it is filled', () => {
        it.each([
            ['record', () => port.record(sampleEntry)],
            ['recordBatch', () => port.recordBatch([sampleEntry])],
            ['markReverted', () => port.markReverted({ entryId: 'x', expectedFingerprint: 'fp' })],
            ['clear', () => port.clear()],
        ])('%s throws naming the port and its registrar', (name, read) => {
            expect(read).toThrow(`actionHistoryMetadataPort.${name}: no action history port is registered`);
            expect(read).toThrow(REGISTRAR);
        });
    });

    describe('filled port', () => {
        it('delegates record to the filled implementation and returns its result', () => {
            const recordFn = vi.fn(() => ['fp-a', 'fp-b']);
            setPort({ record: recordFn, markReverted: () => ({ status: 'unavailable' }), clear: () => undefined });

            const result = port.record(sampleEntry);

            expect(recordFn).toHaveBeenCalledWith(sampleEntry);
            expect(result).toEqual(['fp-a', 'fp-b']);
        });

        it('delegates markReverted to the filled implementation with the input', () => {
            const markFn = vi.fn(() => ({ status: 'marked' as const }));
            setPort({ record: () => [], markReverted: markFn, clear: () => undefined });

            const result = port.markReverted({ entryId: 'e1', expectedFingerprint: 'fp' });

            expect(markFn).toHaveBeenCalledWith({ entryId: 'e1', expectedFingerprint: 'fp' });
            expect(result).toEqual({ status: 'marked' });
        });

        it('delegates clear to the filled implementation', () => {
            const clearFn = vi.fn();
            setPort({ record: () => [], markReverted: () => ({ status: 'unavailable' }), clear: clearFn });

            port.clear();

            expect(clearFn).toHaveBeenCalledTimes(1);
        });

        it('records a batch one entry at a time when the filled port has no batch method', () => {
            const recordFn = vi.fn((entry: { id: string }) => [`evicted-${entry.id}`]);
            setPort({ record: recordFn, markReverted: () => ({ status: 'unavailable' }), clear: () => undefined });

            const result = port.recordBatch([sampleEntry, { ...sampleEntry, id: 'entry-2' }]);

            expect(recordFn).toHaveBeenCalledTimes(2);
            expect(result).toEqual(['evicted-entry-1', 'evicted-entry-2']);
        });

        it('hands a batch to the filled port whole when it has a batch method', () => {
            const recordBatch = vi.fn(() => ['batched']);
            setPort({
                record: () => [],
                recordBatch,
                markReverted: () => ({ status: 'unavailable' }),
                clear: () => undefined,
            });

            const result = port.recordBatch([sampleEntry]);

            expect(recordBatch).toHaveBeenCalledWith([sampleEntry]);
            expect(result).toEqual(['batched']);
        });

        it('a second fill replaces the first', () => {
            const firstRecord = vi.fn(() => ['first']);
            const secondRecord = vi.fn(() => ['second']);
            setPort({ record: firstRecord, markReverted: () => ({ status: 'unavailable' }), clear: () => undefined });
            setPort({ record: secondRecord, markReverted: () => ({ status: 'unavailable' }), clear: () => undefined });

            const result = port.record(sampleEntry);

            expect(firstRecord).not.toHaveBeenCalled();
            expect(secondRecord).toHaveBeenCalledWith(sampleEntry);
            expect(result).toEqual(['second']);
        });
    });
});
