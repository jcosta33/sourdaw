import { describe, expect, it } from 'vitest';

import { deriveEgressVendorShapes } from '../egressVendorShapeExtraction.ts';

describe('egress vendor shape derivation accounting', () => {
    it('classifies every [[rules]] block into exactly one bucket, including a path-keyed rule', () => {
        // Three blocks: a literal-prefix regex rule, a path-only rule with no regex, and a
        // keyword-proximity rule. The path-only rule must be counted and recorded as residual, not
        // silently dropped — a dropped block would make `totalRules` disagree with `blockCount`.
        const toml = String.raw`[[rules]]
id = "acme-token"
description = "An ACME token."
regex = '''acme_[a-z0-9]{20}'''
keywords = ["acme_"]

[[rules]]
id = "p12-file"
description = "A PKCS12 file."
path = '''(?i).+\.p12$'''

[[rules]]
id = "vendor-key"
description = "A vendor key."
regex = '''(?:vendor)[ \t\w.-]{0,20}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)([a-z0-9]{20})'''
keywords = ["vendor"]
`;

        const derived = deriveEgressVendorShapes(toml);

        // Every block is counted, and the classification count agrees with the raw block count.
        expect(derived.counts.blockCount).toBe(3);
        expect(derived.counts.totalRules).toBe(3);
        // (a) the literal-prefix rule becomes a value-complete vendor shape.
        expect(derived.shapes).toHaveLength(1);
        expect(derived.shapes[0]?.parts.join('')).toBe('acme_');
        expect(derived.shapes[0]?.tail).toBe('[a-z0-9]{20}');
        // (b) the path-only rule is recorded as residual, never dropped.
        expect(derived.residual).toEqual([
            { id: 'p12-file', reason: 'keys on a filename, and the screen classifies content' },
        ]);
        // (c) the keyword-proximity rule contributes its vendor keyword.
        expect(derived.keyNames).toEqual(['vendor']);
    });
});
