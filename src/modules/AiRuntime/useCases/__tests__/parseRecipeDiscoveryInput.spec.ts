import { describe, expect, it } from 'vitest';

import { parseRecipeDiscoveryInput } from '../parseRecipeDiscoveryInput';

const ROLES = ['vocal', 'drums', 'bass'];

function refusal(argumentsValue: unknown): string {
    const parsed = parseRecipeDiscoveryInput(argumentsValue, ROLES);
    if (parsed.status !== 'invalid') {
        throw new Error('Expected the arguments to be refused.');
    }
    return parsed.reason;
}

function accepted(argumentsValue: unknown) {
    const parsed = parseRecipeDiscoveryInput(argumentsValue, ROLES);
    if (parsed.status !== 'valid') {
        throw new Error(`Expected the arguments to be accepted, got: ${parsed.reason}`);
    }
    return parsed.input;
}

describe('parseRecipeDiscoveryInput', () => {
    // Red when a call naming nothing to search by is admitted as a search of everything.
    it.each([
        ['no argument at all', {}],
        ['only a limit', { limit: 4 }],
        ['only a target', { targetId: 'track-1' }],
    ])('refuses %s, naming the three ways to search', (_label, argumentsValue) => {
        expect(refusal(argumentsValue)).toBe('recipe.discover requires descriptors, presetTerms or a role');
    });

    it.each([
        ['descriptors', { descriptors: ['warm'] }, { descriptors: ['warm'], presetTerms: [], role: null }],
        ['presetTerms', { presetTerms: ['hall'] }, { descriptors: [], presetTerms: ['hall'], role: null }],
        ['a role', { role: 'drums' }, { descriptors: [], presetTerms: [], role: 'drums' }],
        [
            'all three',
            { descriptors: ['warm'], presetTerms: ['hall'], role: 'vocal' },
            { descriptors: ['warm'], presetTerms: ['hall'], role: 'vocal' },
        ],
    ])('accepts %s alone', (_label, argumentsValue, expected) => {
        expect(accepted(argumentsValue)).toMatchObject({ ...expected, targetId: null, limit: 4 });
    });

    // Red when presetTerms escapes the bounds descriptors keeps, or an empty array counts as a search.
    it.each([
        ['an empty list', []],
        ['five terms', ['a', 'b', 'c', 'd', 'e']],
        ['an empty term', ['']],
        ['a term of 49 characters', ['x'.repeat(49)]],
        ['a non-string term', [7]],
        ['a string instead of a list', 'hall'],
    ])('refuses presetTerms given as %s', (_label, presetTerms) => {
        expect(refusal({ presetTerms, role: 'vocal' })).toContain('presetTerms');
    });

    it('accepts presetTerms at the bounds', () => {
        expect(accepted({ presetTerms: ['a', 'b', 'c', 'x'.repeat(48)] }).presetTerms).toHaveLength(4);
    });

    it.each([
        ['an empty list', []],
        ['five terms', ['a', 'b', 'c', 'd', 'e']],
        ['a term of 49 characters', ['x'.repeat(49)]],
    ])('still refuses descriptors given as %s, even beside a valid search', (_label, descriptors) => {
        expect(refusal({ descriptors, presetTerms: ['hall'] })).toContain('descriptors');
    });

    it('still refuses a key outside the contract', () => {
        expect(refusal({ presetTerms: ['hall'], presetNames: ['hall'] })).toContain('strict discovery contract');
    });

    it('still refuses a role outside the catalog', () => {
        expect(refusal({ role: 'choir' })).toContain('catalog roles');
    });
});
