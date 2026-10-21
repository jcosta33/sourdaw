const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
    21,
];

const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
    MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
}

/** RFC 1321 with one 64-byte block and the full 64-bit little-endian message length. */
export function createIncrementalMd5() {
    const block = new Uint8Array(64);
    const view = new DataView(block.buffer);
    let used = 0;
    let byteCount = 0n;
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    let finalized = false;
    function compress() {
        let a = a0, b = b0, c = c0, d = d0;
        for (let index = 0; index < 64; index++) {
            let f: number, word: number;
            if (index < 16) { f = (b & c) | (~b & d); word = index; }
            else if (index < 32) { f = (d & b) | (~d & c); word = (5 * index + 1) & 15; }
            else if (index < 48) { f = b ^ c ^ d; word = (3 * index + 5) & 15; }
            else { f = c ^ (b | ~d); word = (7 * index) & 15; }
            f = (f + a + MD5_K[index]! + view.getUint32(word * 4, true)) >>> 0;
            a = d; d = c; c = b;
            const rotation = MD5_S[index]!;
            b = (b + ((f << rotation) | (f >>> (32 - rotation)))) >>> 0;
        }
        a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0;
        c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
    }
    return {
        update(bytes: Uint8Array) {
            if (finalized) throw new Error('MD5 is already finalized.');
            byteCount += BigInt(bytes.length);
            for (let offset = 0; offset < bytes.length;) {
                const count = Math.min(64 - used, bytes.length - offset);
                block.set(bytes.subarray(offset, offset + count), used);
                offset += count; used += count;
                if (used === 64) { compress(); used = 0; }
            }
        },
        digest() {
            if (finalized) throw new Error('MD5 is already finalized.');
            finalized = true;
            block[used++] = 0x80;
            block.fill(0, used);
            if (used > 56) { compress(); block.fill(0); }
            view.setBigUint64(56, BigInt.asUintN(64, byteCount * 8n), true);
            compress();
            const result = new Uint8Array(16);
            const output = new DataView(result.buffer);
            output.setUint32(0, a0, true); output.setUint32(4, b0, true);
            output.setUint32(8, c0, true); output.setUint32(12, d0, true);
            return result;
        },
    };
}
