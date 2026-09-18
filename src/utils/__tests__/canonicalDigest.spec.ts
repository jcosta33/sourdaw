import { describe, expect, it } from 'vitest';

import { canonicalJson, digest } from '../canonicalDigest';

describe('canonicalDigest', () => {
    it('digests the canonical form of a value to a stable hex string', () => {
        expect(canonicalJson({ a: 1 })).toBe('{"a":1}');
        expect(digest({ a: 1 })).toBe('015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862');
    });

    it('sorts object keys so two orderings of the same value share one digest', () => {
        expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }));
        expect(digest({ a: 1, b: 2 })).not.toBe(digest({ a: 2, b: 1 }));
    });
});
