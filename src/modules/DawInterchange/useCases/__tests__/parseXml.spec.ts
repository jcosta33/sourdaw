import { describe, it, expect } from 'vitest';

import { parseXml } from '../parse-xml';

describe('parseXml', () => {
    it('returns a Document for valid XML', () => {
        const doc = parseXml('<Root><Child /></Root>');
        expect(doc.documentElement.tagName).toBe('Root');
        expect(doc.getElementsByTagName('Child')).toHaveLength(1);
    });

    it('throws for malformed XML', () => {
        expect(() => parseXml('<<<broken')).toThrow(/Invalid XML/);
    });

    it('throws for unclosed tags', () => {
        expect(() => parseXml('<Root><Child></Root>')).toThrow(/Invalid XML/);
    });

    it('parses an XML declaration', () => {
        const doc = parseXml('<?xml version="1.0"?><Root />');
        expect(doc.documentElement.tagName).toBe('Root');
    });

    it('parses attributes', () => {
        const doc = parseXml('<Root id="r1" active="true" />');
        expect(doc.documentElement.getAttribute('id')).toBe('r1');
        expect(doc.documentElement.getAttribute('active')).toBe('true');
    });
});
