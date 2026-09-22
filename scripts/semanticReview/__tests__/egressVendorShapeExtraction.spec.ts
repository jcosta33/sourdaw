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

    it('decodes a basic string and reads a quoted key and tight spacing', () => {
        // A basic string is TOML-unescaped, so an escaped backslash yields a real `\w` shorthand, an
        // escaped quote yields a literal quote, and a quoted key or missing space around `=` is read.
        const toml = String.raw`[[rules]]
id = "escaped-basic"
description = "An escaped basic string."
regex = "acme_\\w{20}"
keywords = ["acme_"]

[[rules]]
id = "quoted-key"
description = "A quoted key."
"regex"='''acme_"[a-z0-9]{20}"'''
keywords = ["acme2_"]
`;

        const derived = deriveEgressVendorShapes(toml);

        expect(derived.counts.blockCount).toBe(2);
        expect(derived.counts.totalRules).toBe(2);
        const [basic, quotedKey] = derived.shapes;
        expect(basic?.parts.join('')).toBe('acme_');
        expect(basic?.tail).toBe('\\w{20}');
        expect(quotedKey?.parts.join('')).toBe('acme_');
        expect(quotedKey?.tail).toBe('"[a-z0-9]{20}"');
    });

    it('counts a rule header with a trailing comment independently of the splitter', () => {
        // A trailing comment on a `[[rules]]` header is a legal TOML form; the raw count and the
        // splitter must both see it, so the rule is not swallowed while the counters agree.
        const toml = String.raw`[[rules]] # acme rule
id = "acme-token"
description = "An ACME token."
regex = '''acme_[a-z0-9]{20}'''

[[rules]]
id = "p12-file"
description = "A PKCS12 file."
path = '''(?i).+\.p12$'''
`;

        const derived = deriveEgressVendorShapes(toml);

        expect(derived.counts.blockCount).toBe(2);
        expect(derived.counts.totalRules).toBe(2);
        expect(derived.shapes.map((shape) => shape.parts.join(''))).toEqual(['acme_']);
        expect(derived.residual.map((rule) => rule.id)).toEqual(['p12-file']);
    });

    it('decodes a multiline basic string the way TOML does', () => {
        // A newline immediately after the opening delimiter is trimmed, a line-ending backslash is a
        // continuation, and a CRLF leaves no stray carriage return, so the derived tail matches what
        // tomllib would read rather than a pattern beginning with a newline.
        const toml =
            '[[rules]]\nid = "multi-basic"\ndescription = "A multiline token."\nregex = """\nzzz_[a-z0-9]{20}"""\n';
        const derived = deriveEgressVendorShapes(toml);

        expect(derived.counts.blockCount).toBe(1);
        expect(derived.counts.totalRules).toBe(1);
        expect(derived.shapes.map((shape) => shape.parts.join(''))).toEqual(['zzz_']);
        expect(derived.shapes[0]?.tail).toBe('[a-z0-9]{20}');

        const continued =
            '[[rules]]\nid = "multi-cont"\ndescription = "A continuation."\nregex = """zzz_[a-z0-9\\\n]{20}"""\n';
        expect(deriveEgressVendorShapes(continued).shapes[0]?.tail).toBe('[a-z0-9]{20}');

        const crlf =
            '[[rules]]\r\nid = "multi-crlf"\r\ndescription = "A CRLF token."\r\nregex = """\r\nzzz_[a-z0-9]{20}"""\r\n';
        expect(deriveEgressVendorShapes(crlf).shapes[0]?.tail).toBe('[a-z0-9]{20}');
    });

    it('reads quoted and tightly-spaced keys for every scalar field', () => {
        // `keywords`, `secretGroup` and `entropy` must accept a quoted key and tight spacing exactly as
        // the string fields do, so a legal form is never read as absent and reported as a false reason.
        const toml = String.raw`[[rules]]
id = "proximity"
description = "A proximity rule."
regex = '''(?:vendor)[ \t\w.-]{0,20}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)([a-z0-9]{20})'''
keywords=["vendorx"]

[[rules]]
id = "quoted-keyword"
description = "A quoted-keyword rule."
regex = '''(?:other)[ \t\w.-]{0,20}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)([a-z0-9]{20})'''
"keywords" = ["vendory"]
`;

        const derived = deriveEgressVendorShapes(toml);

        expect(derived.keyNames).toEqual(['vendorx', 'vendory']);
        expect(derived.residual).toEqual([]);
    });

    it('routes secretGroup and entropy through the same key pattern', () => {
        // A quoted `secretGroup` key must still record the indirection rather than emit a shape, and a
        // tightly-spaced `entropy` key must still be read as the entropy gate.
        const toml = String.raw`[[rules]]
id = "grouped"
description = "A grouped rule."
regex = '''acme_[a-z0-9]{20}'''
"secretGroup" = 2

[[rules]]
id = "entropy-gated"
description = "An entropy-gated rule."
regex = '''other_[a-z0-9]{20}'''
entropy=2.0
keywords = ["other_"]
`;

        const derived = deriveEgressVendorShapes(toml);

        expect(derived.shapes.map((shape) => shape.parts.join(''))).toEqual(['other_']);
        expect(derived.residual).toEqual([{ id: 'grouped', reason: 'secretGroup indirection' }]);
    });

    it('recognises a quoted [[rules]] header and refuses a config with no rules', () => {
        // `[['rules']]` is a legal array-of-tables header; both the counter and the splitter must see
        // it rather than write an empty table. A config with no rules at all is refused, never written.
        const toml = String.raw`[['rules']]
id = "acme-token"
description = "An ACME token."
regex = '''acme_[a-z0-9]{20}'''
`;

        const derived = deriveEgressVendorShapes(toml);

        expect(derived.counts.blockCount).toBe(1);
        expect(derived.counts.totalRules).toBe(1);
        expect(derived.shapes.map((shape) => shape.parts.join(''))).toEqual(['acme_']);

        expect(() => deriveEgressVendorShapes('no rules here\n')).toThrow(/no readable rule/);
        expect(() => deriveEgressVendorShapes('')).toThrow(/no readable rule/);
    });
});
