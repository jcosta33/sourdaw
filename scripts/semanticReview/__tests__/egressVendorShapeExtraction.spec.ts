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

    it('reads the accepted string and array forms', () => {
        // The accepted grammar: basic-string id/description, a single-line multi-line-literal regex, a
        // single-line keyword array, and a four-space-indented multi-line keyword array.
        const toml = String.raw`[[rules]]
id = "acme-token"
description = "An ACME token."
regex = '''acme_[a-z0-9]{20}'''
keywords = ["acme_", "acme2_"]

[[rules]]
id = "multi-keyword"
description = "A multi-line keyword list."
regex = '''(?:vendor)[ \t\w.-]{0,20}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)([a-z0-9]{20})'''
keywords = [
    "vendorx",
    "vendory",
]
`;

        const derived = deriveEgressVendorShapes(toml);

        expect(derived.counts.blockCount).toBe(2);
        expect(derived.counts.totalRules).toBe(2);
        expect(derived.shapes.map((shape) => shape.parts.join(''))).toEqual(['acme_']);
        expect(derived.keyNames).toEqual(['vendorx', 'vendory']);
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

    it('reports a dropped block as raw count exceeding the classified count', () => {
        // A block with no readable id is dropped, and the raw block count must then exceed the
        // classified count so the generator refuses instead of writing a table that lost a family.
        const toml = String.raw`[[rules]]
id = "acme-token"
description = "An ACME token."
regex = '''acme_[a-z0-9]{20}'''

[[rules]]
description = "No id."
regex = '''other_[a-z0-9]{20}'''
`;

        const derived = deriveEgressVendorShapes(toml);

        expect(derived.counts.blockCount).toBe(2);
        expect(derived.counts.totalRules).toBe(1);
        expect(derived.counts.blockCount).toBeGreaterThan(derived.counts.totalRules);
    });

    it('refuses a rule whose key occurs twice', () => {
        const toml = String.raw`[[rules]]
id = "twice"
description = "A duplicated field."
regex = '''acme_[a-z0-9]{20}'''
regex = '''other_[a-z0-9]{20}'''
`;

        expect(() => deriveEgressVendorShapes(toml)).toThrow(/duplicate top-level field "regex"/);
    });

    it('refuses an indented header or key', () => {
        expect(() => deriveEgressVendorShapes('  [[rules]]\nid = "x"\n')).toThrow(/line 1/);
        expect(() =>
            deriveEgressVendorShapes("[[rules]]\n  id = \"x\"\ndescription = \"d\"\nregex = '''acme_[a-z0-9]{20}'''\n")
        ).toThrow(/line 2/);
    });

    it('refuses a quoted header or key', () => {
        expect(() => deriveEgressVendorShapes('[[\'rules\']]\nid = "x"\n')).toThrow(/line 1/);
        expect(() =>
            deriveEgressVendorShapes(
                '[[rules]]\n"id" = "x"\ndescription = "d"\nregex = \'\'\'acme_[a-z0-9]{20}\'\'\'\n'
            )
        ).toThrow(/line 2/);
    });

    it('refuses tight spacing around =', () => {
        const toml = "[[rules]]\nid=\"x\"\ndescription = \"d\"\nregex = '''acme_[a-z0-9]{20}'''\n";
        expect(() => deriveEgressVendorShapes(toml)).toThrow(/line 2/);
    });

    it('refuses a trailing comment after a header', () => {
        const toml = "[[rules]] # acme rule\nid = \"x\"\ndescription = \"d\"\nregex = '''acme_[a-z0-9]{20}'''\n";
        expect(() => deriveEgressVendorShapes(toml)).toThrow(/line 1/);
    });

    it('refuses an inline comment after a value', () => {
        const toml = "[[rules]]\nid = \"x\"\ndescription = \"d\"\nregex = '''acme_[a-z0-9]{20}''' # trailing\n";
        expect(() => deriveEgressVendorShapes(toml)).toThrow(/line 4/);
    });

    it('refuses a bracket inside a keyword element', () => {
        const toml =
            '[[rules]]\nid = "x"\ndescription = "d"\nregex = \'\'\'acme_[a-z0-9]{20}\'\'\'\nkeywords = ["datadog", "other]x"]\n';
        expect(() => deriveEgressVendorShapes(toml)).toThrow(/line 5/);
    });

    it('refuses a nested array', () => {
        const toml =
            '[[rules]]\nid = "x"\ndescription = "d"\nregex = \'\'\'acme_[a-z0-9]{20}\'\'\'\nkeywords = [["nested"], ["datadog"]]\n';
        expect(() => deriveEgressVendorShapes(toml)).toThrow(/line 5/);
    });

    it('refuses a multi-line basic string', () => {
        const toml = '[[rules]]\nid = "x"\ndescription = "d"\nregex = """acme_[a-z0-9]{20}"""\n';
        expect(() => deriveEgressVendorShapes(toml)).toThrow(/line 4/);
    });

    it('refuses a multi-line literal string that spans lines', () => {
        const toml = "[[rules]]\nid = \"x\"\ndescription = \"d\"\nregex = '''acme_[a-z0-9]{20}\n'''\n";
        expect(() => deriveEgressVendorShapes(toml)).toThrow(/line 4/);
    });

    it('refuses a config with no rules', () => {
        expect(() => deriveEgressVendorShapes('')).toThrow(/no readable rule/);
        expect(() => deriveEgressVendorShapes('# only a comment\n')).toThrow(/no readable rule/);
    });

    it('refuses when headers are present but no rule is readable', () => {
        // A header whose block has no readable id yields headers but zero rules; the refusal must fire
        // on the zero-rule condition, not on the zero-header condition.
        const toml = "[[rules]]\ndescription = \"No id.\"\nregex = '''acme_[a-z0-9]{20}'''\n";
        expect(() => deriveEgressVendorShapes(toml)).toThrow(/1 \[\[rules\]\] headers but no readable rule/);
    });

    it('derives the case scope for a leading and an inline flag, independent of the table', () => {
        // The extraction, not the checked-in table, must reproduce the source's case scope: a leading
        // `(?i)` makes the whole pattern insensitive (`flags` `iu`), while an inline `(?i)` scopes only
        // the remainder as a `(?i:…)` tail group and keeps the prefix case-sensitive (`flags` `u`).
        const toml = String.raw`[[rules]]
id = "leading-insensitive"
description = "A leading flag."
regex = '''(?i)CLOJARS_[a-z0-9]{60}'''

[[rules]]
id = "inline-insensitive"
description = "An inline flag."
regex = '''FLWPUBK_TEST-(?i)[a-h0-9]{32}-X'''
`;

        const derived = deriveEgressVendorShapes(toml);
        const [leading, inline] = derived.shapes;

        expect(leading?.parts.join('')).toBe('CLOJARS_');
        expect(leading?.flags).toBe('iu');
        expect(leading?.bodyInsensitive).toBe(true);
        expect(leading?.tail).toBe('[a-z0-9]{60}');

        expect(inline?.parts.join('')).toBe('FLWPUBK_TEST-');
        expect(inline?.flags).toBe('u');
        expect(inline?.bodyInsensitive).toBe(true);
        expect(inline?.tail).toBe('(?i:[a-h0-9]{32}-X)');
    });

    it('derives identical rules from an LF config and its CRLF twin', () => {
        // The reader must consume lines with the carriage return stripped, so a CRLF file derives the
        // same key names as its LF twin instead of silently re-bucketing the rule.
        const lf = String.raw`[[rules]]
id = "keyword"
description = "A keyword rule."
regex = '''(?:vendor)[ \t\w.-]{0,20}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)([a-z0-9]{20})'''
keywords = [
    "vendorx",
    "vendory",
]
`;
        const crlf = lf.replaceAll('\n', '\r\n');

        const fromLf = deriveEgressVendorShapes(lf);
        const fromCrlf = deriveEgressVendorShapes(crlf);

        expect(fromLf.keyNames).toEqual(['vendorx', 'vendory']);
        expect(fromCrlf.keyNames).toEqual(['vendorx', 'vendory']);
        expect(fromCrlf.counts).toEqual(fromLf.counts);
        expect(fromCrlf.shapes).toEqual(fromLf.shapes);
        expect(fromCrlf.residual).toEqual(fromLf.residual);
    });
});
