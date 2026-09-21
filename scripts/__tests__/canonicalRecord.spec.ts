/**
 * The frozen evidence contract's byte-level foundation (#3372, spec #3367 AC-006): every durable
 * review-evidence record serializes through `canonicalJson` and every protected public event rides
 * the shared marker-line grammar, so these rules are pinned directly rather than only through the
 * record types built on them.
 */

import { describe, expect, it } from 'vitest';

import { canonicalJson, isMarkerLine, lastMarkerLine, parseMarkerPayload } from '../canonicalRecord.ts';

describe('canonicalJson', () => {
    it('sorts object members and drops whitespace, independent of insertion order', () => {
        const left = { b: 1, a: { d: [true, null], c: 'x' } };
        const right = { a: { c: 'x', d: [true, null] }, b: 1 };
        expect(canonicalJson(left)).toBe('{"a":{"c":"x","d":[true,null]},"b":1}');
        expect(canonicalJson(left)).toBe(canonicalJson(right));
    });

    it('keeps array order significant', () => {
        expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
    });

    it('round-trips one record to exactly one byte representation', () => {
        const payload = canonicalJson({ head: 'a'.repeat(40), sequence: 0, events: [] });
        expect(parseMarkerPayload(payload, 'test')).toEqual({ head: 'a'.repeat(40), sequence: 0, events: [] });
        expect(canonicalJson(parseMarkerPayload(payload, 'test') as Parameters<typeof canonicalJson>[0])).toBe(payload);
    });
});

describe('parseMarkerPayload', () => {
    it('refuses a payload that is not valid JSON', () => {
        expect(() => parseMarkerPayload('{not json', 'test')).toThrow(/test marker line is not valid JSON/);
    });

    it('refuses reordered keys even though JSON.parse would accept them', () => {
        expect(() => parseMarkerPayload('{"b":1,"a":2}', 'test')).toThrow(/not the canonical key-sorted/);
    });

    it('refuses stray whitespace even though JSON.parse would accept it', () => {
        expect(() => parseMarkerPayload('{ "a": 1 }', 'test')).toThrow(/not the canonical key-sorted/);
    });

    it('refuses a duplicate key that JSON.parse would collapse last-wins', () => {
        expect(() => parseMarkerPayload('{"a":1,"a":2}', 'test')).toThrow(/not the canonical key-sorted/);
    });
});

describe('marker-line grammar', () => {
    it('accepts a line starting with the marker token, bare or followed by whitespace', () => {
        expect(isMarkerLine('sourdaw-repair-v1', 'sourdaw-repair-v1')).toBe(true);
        expect(isMarkerLine('sourdaw-repair-v1 {"a":1}', 'sourdaw-repair-v1')).toBe(true);
    });

    it('refuses a token that is only a prefix of a longer word', () => {
        expect(isMarkerLine('sourdaw-repair-v11 {"a":1}', 'sourdaw-repair-v1')).toBe(false);
    });

    it('ignores author-controlled prose that merely mentions the marker token', () => {
        const body = [
            'Fixed, see commit abc123.',
            'The record sourdaw-repair-v1 {"forged":true} describes the repair.',
            '  sourdaw-repair-v1 {"real":true}',
        ].join('\n');
        expect(lastMarkerLine(body, 'sourdaw-repair-v1')).toBe('sourdaw-repair-v1 {"real":true}');
    });

    it('selects the last marker line, so a planted earlier line cannot supersede the newest record', () => {
        const body = 'sourdaw-repair-v1 {"first":true}\nsome prose\nsourdaw-repair-v1 {"second":true}';
        expect(lastMarkerLine(body, 'sourdaw-repair-v1')).toBe('sourdaw-repair-v1 {"second":true}');
    });

    it('returns undefined when the body carries no marker line', () => {
        expect(lastMarkerLine('plain prose\nmore prose', 'sourdaw-repair-v1')).toBeUndefined();
    });
});
