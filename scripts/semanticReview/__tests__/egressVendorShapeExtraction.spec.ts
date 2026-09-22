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

    it('reads the legal TOML string forms and a whitespace-tolerant rule header', () => {
        // Basic-string and multiline-basic `regex`, a literal single-quoted `id`, single-quoted
        // `keywords`, and an indented `[[ rules ]]` header are all legal forms the reader must accept
        // rather than read as absent.
        const toml = String.raw`  [[ rules ]]
id = 'single-token'
description = "A token."
regex = "acme_[a-z0-9]{20}"
keywords = ['acme_']

[[rules]]
id = "multi-token"
description = "A multiline token."
regex = """acme2_[a-z0-9]{20}"""
keywords = ["acme2_"]
`;

        const derived = deriveEgressVendorShapes(toml);

        expect(derived.counts.blockCount).toBe(2);
        expect(derived.counts.totalRules).toBe(2);
        expect(derived.shapes.map((shape) => shape.parts.join(''))).toEqual(['acme_', 'acme2_']);
        expect(derived.residual).toEqual([]);
    });

    it('reports a dropped block as raw count exceeding the classified count', () => {
        // A block whose id is in a form the reader cannot parse is dropped, and the raw block count
        // must then exceed the classified count so the generator refuses instead of writing a table
        // that silently loses a family.
        const toml = String.raw`[[rules]]
id = "acme-token"
description = "An ACME token."
regex = '''acme_[a-z0-9]{20}'''

[[rules]]
id = unreadable
description = "An id in a form the reader cannot parse."
regex = '''other_[a-z0-9]{20}'''
`;

        const derived = deriveEgressVendorShapes(toml);

        expect(derived.counts.blockCount).toBe(2);
        expect(derived.counts.totalRules).toBe(1);
        expect(derived.counts.blockCount).toBeGreaterThan(derived.counts.totalRules);
    });

    it('records a keyword-proximity rule whose keywords yield no usable key name', () => {
        // A keyword-proximity rule whose keywords are all generic words contributes no key name, so
        // it must be recorded as residual rather than reported under keyword coverage while firing
        // nothing.
        const toml = String.raw`[[rules]]
id = "generic-key"
description = "A generic key."
regex = '''(?:key)[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)([a-z0-9]{20})'''
keywords = ["key"]
`;

        const derived = deriveEgressVendorShapes(toml);

        expect(derived.counts.blockCount).toBe(1);
        expect(derived.counts.totalRules).toBe(1);
        expect(derived.shapes).toEqual([]);
        expect(derived.keyNames).toEqual([]);
        expect(derived.residual).toEqual([
            { id: 'generic-key', reason: 'keyword-proximity rule yields no usable key name' },
        ]);
    });
});
