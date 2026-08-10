import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { extractGuardedZip } from '../extractGuardedZip';

function zip(entries: Record<string, Uint8Array>): Uint8Array {
    return zipSync(entries);
}

function bytes(length: number, value = 1): Uint8Array {
    return new Uint8Array(length).fill(value);
}

function pseudoRandomBytes(length: number): Uint8Array {
    const result = new Uint8Array(length);
    let state = 0x9e3779b9;
    for (let index = 0; index < result.length; index += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        result[index] = state & 0xff;
    }
    return result;
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

describe('extractGuardedZip', () => {
    it('extracts only selected entries after validating the whole inventory', async () => {
        const result = await extractGuardedZip({
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
    ])('rejects %s limits before extraction', async (_name, archive, restrictLimits, message) => {
        await expect(extractGuardedZip({ bytes: archive, restrictLimits })).rejects.toThrow(message);
    });

    it.each(['../escape.bin', 'dir/../escape.bin', '/absolute.bin', 'C:/absolute.bin', 'dir\\escape.bin'])(
        'rejects unsafe path %s',
        async (path) => {
            await expect(extractGuardedZip({ bytes: zip({ [path]: bytes(1) }) })).rejects.toThrow(
                /unsafe archive path/i
            );
        }
    );

    it('rejects symbolic links before extraction', async () => {
        const archive = markFirstEntryAsSymlink(zip({ 'link.bin': bytes(1) }));
        await expect(extractGuardedZip({ bytes: archive })).rejects.toThrow(/symbolic links/i);
    });

    it('rejects nested archive names before extraction', async () => {
        await expect(extractGuardedZip({ bytes: zip({ 'nested.zip': bytes(1) }) })).rejects.toThrow(
            /nested archive entries/i
        );
    });

    it('rejects disguised nested ZIP content before publishing a result', async () => {
        const nested = zip({ 'payload.bin': bytes(1) });
        await expect(extractGuardedZip({ bytes: zip({ 'nested.bin': nested }) })).rejects.toThrow(
            /nested archive content/i
        );
    });

    it('supports cancellation without publishing extracted entries', async () => {
        const controller = new AbortController();
        const extraction = extractGuardedZip({
            bytes: zip({ 'large.bin': pseudoRandomBytes(1024 * 1024) }),
            signal: controller.signal,
        });
        controller.abort();

        await expect(extraction).rejects.toMatchObject({ name: 'AbortError' });
    });
});
