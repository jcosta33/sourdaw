export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readReceiptSummary(message: string): { value: string; truncated: boolean } {
    const section = message.match(/(?:^|\n)relevant_evidence:\n([^\n]+)/)?.[1];
    if (section === undefined) {
        throw new Error('Missing relevant evidence');
    }
    const evidence: unknown = JSON.parse(section);
    if (!isRecord(evidence) || !Array.isArray(evidence.receipts) || evidence.receipts.length !== 1) {
        throw new Error('Expected exactly one correlated receipt summary');
    }
    const receipt: unknown = evidence.receipts[0];
    if (
        !isRecord(receipt) ||
        !isRecord(receipt.summary) ||
        typeof receipt.summary.value !== 'string' ||
        typeof receipt.summary.truncated !== 'boolean'
    ) {
        throw new Error('Invalid receipt summary');
    }
    return { value: receipt.summary.value, truncated: receipt.summary.truncated };
}

export function decodeReceiptContext(context: string): unknown[] {
    const encoded = context.split('\n').at(-1);
    if (encoded === undefined) {
        throw new Error('Missing receipt wire');
    }
    const wire: unknown = JSON.parse(encoded);
    if (isRecord(wire) && wire.version === undefined && Array.isArray(wire.receipts)) {
        return wire.receipts;
    }
    if (
        !isRecord(wire) ||
        wire.version !== 1 ||
        !Array.isArray(wire.layouts) ||
        !Array.isArray(wire.strings) ||
        !Array.isArray(wire.shared)
    ) {
        throw new Error('Invalid receipt wire');
    }
    const layouts: unknown[] = wire.layouts;
    const strings: unknown[] = wire.strings;
    const shared: unknown[] = wire.shared;
    function index(value: unknown, length: number): number {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= length) {
            throw new Error('Invalid receipt reference');
        }
        return value;
    }
    function decode(value: unknown): unknown {
        if (Array.isArray(value)) {
            return value.map(decode);
        }
        if (!isRecord(value)) {
            return value;
        }
        const keys = Object.keys(value);
        if (keys.length === 1 && keys[0] === '$s') {
            const found = strings[index(value.$s, strings.length)];
            if (typeof found !== 'string') {
                throw new TypeError('Invalid receipt string');
            }
            return found;
        }
        if (keys.length === 1 && keys[0] === '$v') {
            return decode(shared[index(value.$v, shared.length)]);
        }
        if (keys.length === 1 && keys[0] === '$r') {
            if (!Array.isArray(value.$r)) {
                throw new TypeError('Invalid receipt row');
            }
            const [rowIndex, ...values]: unknown[] = value.$r;
            const layout: unknown = layouts[index(rowIndex, layouts.length)];
            if (
                !Array.isArray(layout) ||
                layout.length !== values.length ||
                !layout.every((key) => typeof key === 'string')
            ) {
                throw new Error('Invalid receipt layout');
            }
            return Object.fromEntries(layout.map((key, i) => [key, decode(values[i])]));
        }
        if (keys.length === 1 && keys[0] === '$l') {
            if (!Array.isArray(value.$l)) {
                throw new TypeError('Invalid literal receipt object');
            }
            return Object.fromEntries(
                value.$l.map((pair: unknown) => {
                    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') {
                        throw new Error('Invalid literal receipt pair');
                    }
                    return [pair[0], decode(pair[1])];
                })
            );
        }
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decode(child)]));
    }
    const receipts = decode(wire.receipts);
    if (!Array.isArray(receipts)) {
        throw new TypeError('Invalid decoded receipts');
    }
    return receipts;
}
