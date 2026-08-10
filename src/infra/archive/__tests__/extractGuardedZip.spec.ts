import { gzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { extractGuardedZip } from '../extractGuardedZip';

const zip = zipSync;
function bytes(length: number, value = 1): Uint8Array {
    return new Uint8Array(length).fill(value);
}
function markFirstEntryAsSymlink(archive: Uint8Array): Uint8Array {
    return mutateHeaders(archive, (view, offset, central) => {
        if (central) {
            view.setUint16(offset + 4, (3 << 8) | 20, true);
            view.setUint32(offset + 38, 0xa1ff0000, true);
        }
    });
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
function prefixZip(archive: Uint8Array, prefixLength: number): Uint8Array {
    const result = new Uint8Array(prefixLength + archive.byteLength).fill(0x41, 0, prefixLength);
    result.set(archive, prefixLength);
    const view = new DataView(result.buffer);
    for (let offset = prefixLength; offset <= result.byteLength - 4; offset += 1) {
        const signature = view.getUint32(offset, true);
        if (signature === 0x02014b50) {
            view.setUint32(offset + 42, view.getUint32(offset + 42, true) + prefixLength, true);
        } else if (signature === 0x06054b50) {
            view.setUint32(offset + 16, view.getUint32(offset + 16, true) + prefixLength, true);
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
    it('runs caller inventory validation before inflating selected entries', () => {
        const archive = zipSync({ 'stored.bin': [bytes(4), { level: 0 }] });
        const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
        const dataOffset = 30 + view.getUint16(26, true) + view.getUint16(28, true);
        archive[dataOffset] = (archive[dataOffset] ?? 0) ^ 0xff;
        expect(() =>
            extractGuardedZip({
                bytes: archive,
                validateInventory: (paths) => {
                    expect(paths).toEqual(['stored.bin']);
                    throw new Error('Caller rejected the ZIP inventory');
                },
            })
        ).toThrow(/caller rejected/i);
    });
    it.each([
        ['entry count', zip({ 'one.bin': bytes(1), 'two.bin': bytes(1) }), { maxEntries: 1 }, /entry count/i],
        ['entry size', zip({ 'large.bin': bytes(4) }), { maxEntryUncompressedBytes: 3 }, /entry exceeds/i],
        ['total', zip({ a: bytes(4), b: bytes(4) }), { maxTotalUncompressedBytes: 7 }, /total uncompressed bytes/i],
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
    it.each([
        [1, /encrypted/i],
        [8, /data-descriptor/i],
    ])('rejects unsupported general-purpose flag %i', (flag, message) => {
        const archive = mutateHeaders(zip({ 'streamed.bin': bytes(4) }), (view, offset, central) => {
            const flagOffset = central ? 8 : 6;
            view.setUint16(offset + flagOffset, view.getUint16(offset + flagOffset, true) | flag, true);
        });
        expect(() => extractGuardedZip({ bytes: archive })).toThrow(message);
    });
    it('rejects output that exceeds its declared size', () => {
        const archive = mutateHeaders(zip({ 'forged.bin': bytes(1024 * 1024, 0) }), (view, offset, central) => {
            view.setUint32(offset + (central ? 24 : 22), 1, true);
        });
        expect(() => extractGuardedZip({ bytes: archive })).toThrow(/declared size/i);
    });

    it('rejects entries whose output does not match the declared CRC', () => {
        const archive = zipSync({ 'stored.bin': [bytes(4), { level: 0 }] });
        const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
        const dataOffset = 30 + view.getUint16(26, true) + view.getUint16(28, true);
        archive[dataOffset] = (archive[dataOffset] ?? 0) ^ 0xff;
        expect(() => extractGuardedZip({ bytes: archive })).toThrow(/CRC/i);
    });

    it('returns an own entry named __proto__ without changing the result prototype', () => {
        const archive = mutateHeaders(zip({ '123456789': bytes(1) }), (view, offset, central) => {
            for (const [index, byte] of new TextEncoder().encode('__proto__').entries()) {
                view.setUint8(offset + (central ? 46 : 30) + index, byte);
            }
        });
        const result = extractGuardedZip({ bytes: archive });
        expect(Object.hasOwn(result, '__proto__')).toBe(true);
        expect(Array.from(result.__proto__ ?? [])).toEqual([1]);
    });

    it('rejects nested archive names before extraction', () => {
        expect(() => extractGuardedZip({ bytes: zip({ 'nested.zip': bytes(1) }) })).toThrow(/nested archive entries/i);
    });

    it.each([
        ['gzip', gzipSync(bytes(8))],
        ['ZIP', zip({ 'payload.bin': bytes(1) })],
        ['empty ZIP', zip({})],
        ['symlink ZIP', markFirstEntryAsSymlink(zip({ link: bytes(1) }))],
        ['long-prefixed ZIP', prefixZip(zip({ 'payload.bin': bytes(1) }), 8192)],
        ['suffixed ZIP', new Uint8Array([...zip({ payload: bytes(1) }), 0])],
    ])('rejects disguised nested %s content', (_name, nested) => {
        expect(() => extractGuardedZip({ bytes: zip({ 'nested.bin': nested }) })).toThrow(/nested archive content/i);
    });
});
