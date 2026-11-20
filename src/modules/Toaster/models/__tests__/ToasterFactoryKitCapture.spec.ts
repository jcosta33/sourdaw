import { describe, expect, it } from 'vitest';

import { validToasterKitReplacement } from '../ToasterFactoryKitCapture';
import { createDefaultKit } from '../ToasterKit';
import { toToasterKitState } from '../ToasterKitState';

function nestedSibling(levels: number): unknown {
    let value: unknown = 'preserved';
    for (let index = 0; index < levels; index++) {
        value = [value];
    }
    return value;
}

describe('validToasterKitReplacement', () => {
    it('accepts a sibling at the depth limit and refuses one beyond it', () => {
        const chunk = toToasterKitState(createDefaultKit());
        const atLimit = { ...chunk, data: { ...chunk.data, sibling: nestedSibling(63) } };
        const beyondLimit = { ...chunk, data: { ...chunk.data, sibling: nestedSibling(64) } };

        expect(validToasterKitReplacement(atLimit, atLimit)).toBe(true);
        expect(validToasterKitReplacement(beyondLimit, beyondLimit)).toBe(false);
    });

    it('refuses a non-record kit while accepting the serialized kit', () => {
        const chunk = toToasterKitState(createDefaultKit());
        const malformed = { ...chunk, data: { kit: null } };

        expect(validToasterKitReplacement(null, chunk)).toBe(true);
        expect(validToasterKitReplacement(null, malformed)).toBe(false);
    });
});
