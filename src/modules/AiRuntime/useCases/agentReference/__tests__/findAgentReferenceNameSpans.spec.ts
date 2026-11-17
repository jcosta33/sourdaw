import { describe, expect, it } from 'vitest';

import { findAgentReferenceNameSpans } from '../findAgentReferenceNameSpans';

describe('findAgentReferenceNameSpans number forms', () => {
    it('finds a single-word plural name as a number-form span when number forms are allowed', () => {
        expect(findAgentReferenceNameSpans('mute the drum', 'Drums', 'with-number-forms', [])).toEqual([
            { start: 9, end: 13, closeness: 'number-form' },
        ]);
    });

    it('finds nothing for that singular text when only exact forms are allowed', () => {
        expect(findAgentReferenceNameSpans('mute the drum', 'Drums', 'exact', [])).toEqual([]);
    });

    it('finds a multi-word name whose final word is in the other number', () => {
        expect(findAgentReferenceNameSpans('mute the lead vocal', 'Lead Vocals', 'with-number-forms', [])).toEqual([
            { start: 9, end: 19, closeness: 'number-form' },
        ]);
    });
});
