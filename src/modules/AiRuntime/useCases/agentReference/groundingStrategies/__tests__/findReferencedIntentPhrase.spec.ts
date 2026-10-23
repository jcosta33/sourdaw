import { describe, expect, it } from 'vitest';

import { findReferencedIntentPhrase } from '../findReferencedIntentPhrase';

describe('findReferencedIntentPhrase', () => {
    it('reads the placeholder as exactly one masked reference, optionally after an article', () => {
        expect(findReferencedIntentPhrase('set □□□□□ to -6 dB', 'set {reference} to')?.index).toBe(0);
        expect(findReferencedIntentPhrase('set the □□□□□ to -6 dB', 'set {reference} to')?.index).toBe(0);
        expect(findReferencedIntentPhrase('please set □□□□□ to -6 dB', 'set {reference} to')?.index).toBe(7);
    });

    it.each([
        ['no reference', 'set to -6 dB'],
        ['a word that is not a reference', 'set Drums to -6 dB'],
        ['two references', 'set □□□□□ □□□□□□ to -6 dB'],
        ['a reference split by another word', 'set □□□ on □□□ to -6 dB'],
    ])('names nothing with %s between the words', (_label, text) => {
        expect(findReferencedIntentPhrase(text, 'set {reference} to')).toBeNull();
    });

    it('anchors a phrase that opens with the placeholder to the start of the clause', () => {
        expect(findReferencedIntentPhrase('□□□□□ up 2 dB', '{reference} up')?.index).toBe(0);
        expect(findReferencedIntentPhrase('please □□□□□ down 2 dB', '{reference} down')?.index).toBe(7);
        expect(findReferencedIntentPhrase('set □□□□□ up 2 dB', '{reference} up')).toBeNull();
        expect(findReferencedIntentPhrase('□□□□□ upstairs 2 dB', '{reference} up')).toBeNull();
    });
});
