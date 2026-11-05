import { describe, expect, it } from 'vitest';

import {
    MAX_SEMANTIC_QUERY_FILTER_TEXT_LENGTH,
    type SemanticProjectQueryFilters,
} from '../../models/SemanticProjectQuery';
import { getSemanticProjectQueryFiltersSchema } from '../getSemanticProjectQueryFiltersSchema';
import { parseSemanticProjectQueryInput } from '../parseSemanticProjectQueryInput';

/** Typed so that a filter added to the model without a row here fails to compile. */
const ADMITTED_SAMPLE: Required<SemanticProjectQueryFilters> = {
    stableId: 'track-1',
    exactName: 'Lead Vocal',
    fuzzyName: 'lead',
    kind: 'track',
    tag: 'vocal',
    role: 'lead',
    parentId: 'group-1',
    startBeat: 4,
    endBeat: 8,
    sectionId: 'section-1',
    selected: true,
    locked: false,
    muted: false,
    soloed: false,
    deviceType: 'eq',
    deviceCategory: 'dynamics',
    routeFromId: 'a',
    routeToId: 'b',
    hasAutomation: true,
    contentType: 'midi',
    assetType: 'sample',
    minInferredConfidence: 0.5,
};

const EXPECTED_TYPES: Record<keyof SemanticProjectQueryFilters, 'string' | 'boolean' | 'number'> = {
    stableId: 'string',
    exactName: 'string',
    fuzzyName: 'string',
    kind: 'string',
    tag: 'string',
    role: 'string',
    parentId: 'string',
    startBeat: 'number',
    endBeat: 'number',
    sectionId: 'string',
    selected: 'boolean',
    locked: 'boolean',
    muted: 'boolean',
    soloed: 'boolean',
    deviceType: 'string',
    deviceCategory: 'string',
    routeFromId: 'string',
    routeToId: 'string',
    hasAutomation: 'boolean',
    contentType: 'string',
    assetType: 'string',
    minInferredConfidence: 'number',
};

describe('getSemanticProjectQueryFiltersSchema', () => {
    const schema = getSemanticProjectQueryFiltersSchema();

    it('publishes exactly the filters the parser admits, with the parser type for each', () => {
        expect(new Set(Object.keys(schema.properties))).toEqual(new Set(Object.keys(EXPECTED_TYPES)));
        expect(schema.additionalProperties).toBe(false);
        for (const [key, type] of Object.entries(EXPECTED_TYPES)) {
            expect([key, schema.properties[key]?.type]).toEqual([key, type]);
        }
    });

    it('admits a sample value for every published filter through the parser', () => {
        for (const [key, value] of Object.entries(ADMITTED_SAMPLE)) {
            expect([key, parseSemanticProjectQueryInput({ type: 'object', filters: { [key]: value } }).status]).toEqual(
                [key, 'valid']
            );
        }
    });

    it('states the bounds the parser enforces', () => {
        expect(schema.properties.exactName).toEqual({
            type: 'string',
            minLength: 1,
            maxLength: MAX_SEMANTIC_QUERY_FILTER_TEXT_LENGTH,
        });
        expect(schema.properties.minInferredConfidence).toEqual({ type: 'number', minimum: 0, maximum: 1 });
        expect(schema.properties.contentType).toEqual({ type: 'string', enum: ['audio', 'midi'] });
        const overBound = parseSemanticProjectQueryInput({
            type: 'object',
            filters: { exactName: 'x'.repeat(MAX_SEMANTIC_QUERY_FILTER_TEXT_LENGTH + 1) },
        });
        expect(overBound).toEqual({ status: 'invalid', reason: 'filters' });
    });
});
