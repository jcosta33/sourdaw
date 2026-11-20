import { sha256Bytes } from '#/utils/canonicalDigest';

type NativeChangeCodec = Pick<typeof import('@automerge/automerge/slim'), 'encodeChange' | 'decodeChange'>;
type NativeChange = Parameters<NativeChangeCodec['encodeChange']>[0];
type Operations = NativeChange['ops'];
type ByteRange = { start: number; end: number };
type FloatRepair = { expected: number; encoded: number };

const VALUE_METADATA = 86;
const VALUE_BYTES = 87;
const FLOAT_TAG = 5;

class ChangeCursor {
    constructor(
        private readonly bytes: Uint8Array,
        public offset: number,
        private readonly end = bytes.length
    ) {}

    get remaining(): number {
        return this.end - this.offset;
    }

    skip(length: number): void {
        if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
            throw new Error('Invalid native change column range');
        }
        this.offset += length;
    }

    readLeb(signed = false): number {
        let value = 0n;
        for (let shift = 0n; shift < 64n; shift += 7n) {
            const byte = this.bytes[this.offset];
            if (byte === undefined || this.remaining <= 0) {
                break;
            }
            this.offset += 1;
            value |= BigInt(byte & 0x7f) << shift;
            if ((byte & 0x80) === 0) {
                if (signed && (byte & 0x40) !== 0) {
                    value -= 1n << (shift + 7n);
                }
                const number = Number(value);
                if (Number.isSafeInteger(number)) {
                    return number;
                }
                break;
            }
        }
        throw new Error('Invalid native change LEB value');
    }
}

/** Skip framing and non-value columns per the Automerge binary format. */
function readValueColumns(bytes: Uint8Array): { metadata: ByteRange; values: ByteRange } {
    if (bytes[8] !== 1) {
        throw new Error('Exact float encoding requires an uncompressed native change');
    }
    const cursor = new ChangeCursor(bytes, 9);
    const bodyLength = cursor.readLeb();
    if (bodyLength !== cursor.remaining) {
        throw new Error('Invalid native change body length');
    }
    cursor.skip(cursor.readLeb() * 32); // dependencies
    cursor.skip(cursor.readLeb()); // authoring actor ID
    cursor.readLeb(); // sequence number
    cursor.readLeb(); // start operation
    cursor.readLeb(true); // wallclock time
    cursor.skip(cursor.readLeb()); // message
    for (let actors = cursor.readLeb(); actors > 0; actors -= 1) {
        cursor.skip(cursor.readLeb());
    }

    const columnCount = cursor.readLeb();
    if (columnCount > cursor.remaining / 2) {
        throw new Error('Invalid native change column count');
    }
    const columns = Array.from({ length: columnCount }, () => ({
        id: cursor.readLeb(),
        length: cursor.readLeb(),
    }));
    const ranges = new Map<number, ByteRange>();
    for (const { id, length } of columns) {
        const start = cursor.offset;
        cursor.skip(length);
        if (ranges.has(id)) {
            throw new Error('Duplicated native change column');
        }
        ranges.set(id, { start, end: cursor.offset });
    }
    const metadata = ranges.get(VALUE_METADATA);
    const values = ranges.get(VALUE_BYTES);
    if (!metadata || !values) {
        throw new Error('Native change is missing float value columns');
    }
    return { metadata, values };
}

function readFloatRepairs(expected: Operations, encoded: Operations): Map<number, FloatRepair> {
    if (expected.length !== encoded.length) {
        throw new Error('Native change operation count shifted while encoding floats');
    }
    const repairs = new Map<number, FloatRepair>();
    for (const [index, operation] of expected.entries()) {
        if (operation.datatype !== 'float64') {
            continue;
        }
        const actual = encoded[index];
        if (
            actual?.datatype !== 'float64' ||
            typeof actual.value !== 'number' ||
            typeof operation.value !== 'number' ||
            !Number.isFinite(operation.value)
        ) {
            throw new Error('Invalid native float operation');
        }
        if (!Object.is(actual.value, operation.value)) {
            repairs.set(index, { expected: operation.value, encoded: actual.value });
        }
    }
    return repairs;
}

function restoreFloatValues(bytes: Uint8Array, repairs: ReadonlyMap<number, FloatRepair>, opCount: number): void {
    const { metadata, values } = readValueColumns(bytes);
    const cursor = new ChangeCursor(bytes, metadata.start, metadata.end);
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let opIndex = 0;
    let valueOffset = values.start;
    let restored = 0;
    function consumeValue(tag: number): void {
        const size = Math.floor(tag / 16);
        if (valueOffset + size > values.end) {
            throw new Error('Invalid native change raw value range');
        }
        const repair = repairs.get(opIndex);
        if (repair) {
            if (
                tag % 16 !== FLOAT_TAG ||
                size !== 8 ||
                !Object.is(data.getFloat64(valueOffset, true), repair.encoded)
            ) {
                throw new Error('Native float metadata does not match its operation');
            }
            data.setFloat64(valueOffset, repair.expected, true);
            restored += 1;
        }
        opIndex += 1;
        valueOffset += size;
    }

    while (cursor.remaining > 0) {
        const run = cursor.readLeb(true);
        if (run === 0) {
            opIndex += cursor.readLeb();
            continue;
        }
        const count = Math.abs(run);
        if (opIndex + count > opCount) {
            throw new Error('Invalid native change value metadata run');
        }
        if (run > 0) {
            const tag = cursor.readLeb();
            for (let index = 0; index < count; index += 1) {
                consumeValue(tag);
            }
        } else {
            for (let index = 0; index < count; index += 1) {
                consumeValue(cursor.readLeb());
            }
        }
    }
    if (opIndex !== opCount || valueOffset !== values.end || restored !== repairs.size) {
        throw new Error('Native change value columns did not cover the expected operations');
    }
}

function restoreEncodedFloats(expected: Operations, encoded: Operations, bytes: Uint8Array<ArrayBuffer>): boolean {
    const repairs = readFloatRepairs(expected, encoded);
    if (repairs.size === 0) {
        return false;
    }
    restoreFloatValues(bytes, repairs, expected.length);
    bytes.set(sha256Bytes(bytes.subarray(8)).subarray(0, 4), 4);
    return true;
}

/** Preserve the native encoder's framing and restore only floats its decimal ingress rounded. */
export function encodeExactNativeChange(change: NativeChange, codec: NativeChangeCodec) {
    const bytes = Uint8Array.from(codec.encodeChange(change));
    const encoded = codec.decodeChange(bytes);
    if (!restoreEncodedFloats(change.ops, encoded.ops, bytes)) {
        return { bytes, hash: encoded.hash };
    }
    const repaired = codec.decodeChange(bytes);
    if (readFloatRepairs(change.ops, repaired.ops).size > 0) {
        throw new Error('Native change did not preserve exact floats');
    }
    return { bytes, hash: repaired.hash };
}

function equalChangeBytes(left: Uint8Array, right: Uint8Array): boolean {
    return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/** The caller must supply a change decoded from the validated original bytes. Full byte equality proves the round trip. */
export function assertExactNativeChangeEncoding(
    change: NativeChange,
    original: Uint8Array<ArrayBuffer>,
    codec: NativeChangeCodec
): 'byte-equal' | 'exact-float-repair' {
    const encoded = Uint8Array.from(codec.encodeChange(change));
    if (equalChangeBytes(encoded, original)) {
        return 'byte-equal';
    }
    const decoded = codec.decodeChange(encoded);
    restoreEncodedFloats(change.ops, decoded.ops, encoded);
    if (!equalChangeBytes(encoded, original)) {
        throw new Error('Native sequence contains unsupported opaque metadata');
    }
    return 'exact-float-repair';
}
