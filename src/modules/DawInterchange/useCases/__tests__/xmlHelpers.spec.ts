import { describe, it, expect } from 'vitest';

import { wrap } from '../xmlHelpers';

function makeElement(xml: string): Element {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return doc.documentElement;
}

describe('wrap — attr', () => {
    it('returns the attribute value when present', () => {
        const el = makeElement('<Track id="t1" />');
        expect(wrap(el).attr('id')).toBe('t1');
    });

    it('returns null when the attribute is absent', () => {
        const el = makeElement('<Track />');
        expect(wrap(el).attr('id')).toBeNull();
    });
});

describe('wrap — attrNumber', () => {
    it('parses a numeric attribute', () => {
        const el = makeElement('<Clip start="4.5" />');
        expect(wrap(el).attrNumber('start', 0)).toBe(4.5);
    });

    it('falls back when the attribute is absent', () => {
        const el = makeElement('<Clip />');
        expect(wrap(el).attrNumber('start', 99)).toBe(99);
    });

    it('falls back when the attribute is non-numeric', () => {
        const el = makeElement('<Clip start="abc" />');
        expect(wrap(el).attrNumber('start', 7)).toBe(7);
    });
});

describe('wrap — attrBool', () => {
    it('returns true for "true"', () => {
        const el = makeElement('<Track solo="true" />');
        expect(wrap(el).attrBool('solo', false)).toBe(true);
    });

    it('returns true for "1"', () => {
        const el = makeElement('<Track solo="1" />');
        expect(wrap(el).attrBool('solo', false)).toBe(true);
    });

    it('returns false for any other value', () => {
        const el = makeElement('<Track solo="yes" />');
        expect(wrap(el).attrBool('solo', true)).toBe(false);
    });

    it('falls back when the attribute is absent', () => {
        const el = makeElement('<Track />');
        expect(wrap(el).attrBool('solo', true)).toBe(true);
    });
});

describe('wrap — child', () => {
    it('returns a wrapped child element when it exists', () => {
        const el = makeElement('<Parent><Child name="x" /></Parent>');
        const child = wrap(el).child('Child');
        expect(child).not.toBeNull();
        expect(child!.attr('name')).toBe('x');
    });

    it('returns null when no child with that tag exists', () => {
        const el = makeElement('<Parent><Other /></Parent>');
        expect(wrap(el).child('Child')).toBeNull();
    });
});

describe('wrap — children', () => {
    it('returns all children when no tag filter is given', () => {
        const el = makeElement('<Parent><A /><B /><C /></Parent>');
        expect(wrap(el).children()).toHaveLength(3);
    });

    it('filters children by tag name', () => {
        const el = makeElement('<Parent><Clip /><Clip /><Note /></Parent>');
        expect(wrap(el).children('Clip')).toHaveLength(2);
    });

    it('returns an empty array when no children match the filter', () => {
        const el = makeElement('<Parent><Clip /></Parent>');
        expect(wrap(el).children('Note')).toHaveLength(0);
    });
});

describe('wrap — text', () => {
    it('returns the text content of the element', () => {
        const el = makeElement('<Name>Hello</Name>');
        expect(wrap(el).text()).toBe('Hello');
    });

    it('returns empty string for an element with no text content', () => {
        const el = makeElement('<Empty />');
        expect(wrap(el).text()).toBe('');
    });
});
