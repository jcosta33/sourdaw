import { gzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { extractGuardedZip } from '../extractGuardedZip';

function zip(entries: Record<string, Uint8Array>): Uint8Array {
    return zipSync(entries);
}

function bytes(length: number, value = 1): Uint8Array {
    return new Uint8Array(length).fill(value);
}

function markFirstEntryAsSymlink(archive: Uint8Array): Uint8Array {
    const result = archive.slice();
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
    for (let offset = 0; offset <= result.byteLength - 46; offset += 1) {
        if (view.getUint32(offset, true) !== 0x02014b50) {
            continue;
        }
        view.setUint16(offset + 4, (3 << 8) | 20, true);
        view.setUint32(offset + 38, 0xa1ff0000, true);
        return result;
    }
    throw new Error('Fixture has no central-directory entry');
}

function mutateHeaders(archive: Uint8Array, mutate: (view: DataView, offset: number, central: boolean) => void) {
    const result = archive.slice();
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
    for (let offset = 0; offset <= result.byteLength - 4; offset += 1) {
        const signature = view.getUint32(offset, true);
        if (signature === 0x04034b50 || signature === 0x02014b50) {
            mutate(view, offset, signature === 0x02014b50);
        }
    }
    return result;
}

function prefixZip(archive: Uint8Array, prefixLength = 32): Uint8Array {
    const prefix = bytes(prefixLength, 0x41);
    const result = new Uint8Array(prefix.byteLength + archive.byteLength);
    result.set(prefix);
    result.set(archive, prefix.byteLength);
    const view = new DataView(result.buffer);
    for (let offset = prefix.byteLength; offset <= result.byteLength - 4; offset += 1) {
        const signature = view.getUint32(offset, true);
        if (signature === 0x02014b50) {
            view.setUint32(offset + 42, view.getUint32(offset + 42, true) + prefix.byteLength, true);
        } else if (signature === 0x06054b50) {
            view.setUint32(offset + 16, view.getUint32(offset + 16, true) + prefix.byteLength, true);
        }
    }
    return result;
}

describe('extractGuardedZip', () => {
    it('extracts only selected entries after validating the whole inventory', () => {
        const result = extractGuardedZip({
            bytes: zip({ 'model/weights.onnx': bytes(4), 'docs/readme.txt': bytes(8) }),
            include: (path) => path.endsWith('.onnx'),
        });

        expect(Object.keys(result)).toEqual(['model/weights.onnx']);
        expect(Array.from(result['model/weights.onnx'] ?? [])).toEqual([1, 1, 1, 1]);
    });

    it.each([
        ['entry count', zip({ 'one.bin': bytes(1), 'two.bin': bytes(1) }), { maxEntries: 1 }, /entry count/i],
        ['entry size', zip({ 'large.bin': bytes(4) }), { maxEntryUncompressedBytes: 3 }, /entry exceeds/i],
        [
            'total size',
            zip({ 'one.bin': bytes(4), 'two.bin': bytes(4) }),
            { maxTotalUncompressedBytes: 7 },
            /total uncompressed bytes/i,
        ],
        ['ratio', zip({ 'compressed.bin': bytes(4096, 0) }), { maxCompressionRatio: 2 }, /compression ratio/i],
        ['path bytes', zip({ 'long-name.bin': bytes(1) }), { maxPathBytes: 8 }, /archive path length/i],
    ])('rejects %s limits before extraction', (_name, archive, restrictLimits, message) => {
        expect(() => extractGuardedZip({ bytes: archive, restrictLimits })).toThrow(message);
    });

    it.each(['../escape.bin', 'dir/../escape.bin', '/absolute.bin', 'C:/absolute.bin', 'dir\\escape.bin'])(
        'rejects unsafe path %s',
        (path) => {
            expect(() => extractGuardedZip({ bytes: zip({ [path]: bytes(1) }) })).toThrow(/unsafe archive path/i);
        }
    );

    it('rejects symbolic links before extraction', () => {
        const archive = markFirstEntryAsSymlink(zip({ 'link.bin': bytes(1) }));
        expect(() => extractGuardedZip({ bytes: archive })).toThrow(/symbolic links/i);
    });

    it('rejects inconsistent end-record counts before attribute checks', () => {
        const archive = markFirstEntryAsSymlink(zip({ 'link.bin': bytes(1) }));
        const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
        view.setUint16(archive.byteLength - 12, 0, true);
        expect(() => extractGuardedZip({ bytes: archive })).toThrow(/entry count/i);
    });

    it('rejects encrypted entries before extraction', () => {
        const archive = mutateHeaders(zip({ 'secret.bin': bytes(4) }), (view, offset, central) => {
            const flagOffset = central ? 8 : 6;
            view.setUint16(offset + flagOffset, view.getUint16(offset + flagOffset, true) | 1, true);
        });
        expect(() => extractGuardedZip({ bytes: archive })).toThrow(/encrypted/i);
    });

    it('rejects data-descriptor entries before extraction', () => {
        const archive = mutateHeaders(zip({ 'streamed.bin': bytes(4) }), (view, offset, central) => {
            view.setUint16(offset + (central ? 8 : 6), view.getUint16(offset + (central ? 8 : 6), true) | 8, true);
        });
        expect(() => extractGuardedZip({ bytes: archive })).toThrow(/data-descriptor/i);
    });

    it('rejects output that exceeds its declared size', () => {
        const archive = mutateHeaders(zip({ 'forged.bin': bytes(1024 * 1024, 0) }), (view, offset, central) => {
            view.setUint32(offset + (central ? 24 : 22), 1, true);
        });
        expect(() => extractGuardedZip({ bytes: archive })).toThrow(/declared size/i);
    });

    it('rejects nested archive names before extraction', () => {
        expect(() => extractGuardedZip({ bytes: zip({ 'nested.zip': bytes(1) }) })).toThrow(/nested archive entries/i);
    });

    it('rejects disguised nested ZIP content before publishing a result', () => {
        const nested = zip({ 'payload.bin': bytes(1) });
        expect(() => extractGuardedZip({ bytes: zip({ 'nested.bin': nested }) })).toThrow(/nested archive content/i);
    });

    it.each([
        ['gzip', gzipSync(bytes(8))],
        ['empty ZIP', zip({})],
        ['long-prefixed ZIP', prefixZip(zip({ 'payload.bin': bytes(1) }), 8192)],
    ])('rejects disguised nested %s content', (_name, nested) => {
        expect(() => extractGuardedZip({ bytes: zip({ 'nested.bin': nested }) })).toThrow(/nested archive content/i);
    });
});
