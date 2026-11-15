import { describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { RECIPE_DISCOVERY_TOOL_NAME } from '../../models/AgentToolCatalogNames';
import { getAgentToolCatalogSchemas } from '../agentToolCatalog';
import { parseRecipeDiscoveryInput } from '../parseRecipeDiscoveryInput';

registerDeviceEnginePorts();

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
    // Red when a call the advertised schema admits is refused, or a bare call is not a browse.
    it.each([
        ['no argument at all', {}],
        ['only a limit', { limit: 4 }],
        ['only a target', { targetId: 'track-1' }],
        ['a target and a limit', { targetId: 'track-1', limit: 4 }],
    ])('accepts %s as a browse of the preset recipes', (_label, argumentsValue) => {
        expect(accepted(argumentsValue)).toMatchObject({ descriptors: [], presetTerms: [] });
    });

    // Red when the parser and the advertised schema stop agreeing on what a call may carry.
    it('accepts every minimal shape the advertised recipe.discover schema admits', () => {
        const parameters = getAgentToolCatalogSchemas().find(
            (schema) => schema.function.name === RECIPE_DISCOVERY_TOOL_NAME
        )?.function.parameters as {
            properties: Record<string, { type: string; enum?: string[]; minimum?: number }>;
            required: string[];
        };
        const validValue = (property: { type: string; enum?: string[]; minimum?: number }): unknown => {
            if (property.enum !== undefined) {
                return property.enum[0];
            }
            return { array: ['x'], string: 'x', integer: property.minimum }[property.type];
        };
        const entries = Object.entries(parameters.properties).map(([key, property]) => [key, validValue(property)]);
        const shapes = [
            Object.fromEntries(entries.filter(([key]) => parameters.required.includes(String(key)))),
            ...entries.map((entry) => Object.fromEntries([entry])),
        ];

        expect(shapes).toHaveLength(entries.length + 1);
        for (const shape of shapes) {
            expect(parseRecipeDiscoveryInput(shape, getMixRecipeCatalog().roles).status).toBe('valid');
        }
    });

    it.each([
        ['null descriptors', { descriptors: null }],
        ['null presetTerms', { presetTerms: null }],
        ['null role', { role: null }],
        ['null targetId', { targetId: null }],
        ['null limit', { limit: null }],
        ['limit 0', { limit: 0 }],
        ['limit 9', { limit: 9 }],
        ['empty descriptors', { descriptors: [] }],
    ])('refuses %s', (_label, argumentsValue) => {
        expect(parseRecipeDiscoveryInput(argumentsValue, ROLES).status).toBe('invalid');
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

    it('refuses a role outside the catalog', () => {
        expect(refusal({ role: 'choir' })).toContain('catalog roles');
    });
});
