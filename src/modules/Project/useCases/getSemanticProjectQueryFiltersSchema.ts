import { MAX_SEMANTIC_QUERY_FILTER_TEXT_LENGTH } from '../models/SemanticProjectQuery';

import {
    BOOLEAN_FILTER_KEYS,
    CONTENT_TYPE_FILTER_VALUES,
    MIN_INFERRED_CONFIDENCE_RANGE,
    NUMBER_FILTER_KEYS,
    STRING_FILTER_KEYS,
} from './parseSemanticProjectQueryInput';

type FilterPropertySchema =
    | { type: 'string'; minLength: number; maxLength: number }
    | { type: 'string'; enum: readonly string[] }
    | { type: 'boolean' }
    | { type: 'number'; minimum?: number; maximum?: number };

type SemanticProjectQueryFiltersSchema = {
    type: 'object';
    properties: Record<string, FilterPropertySchema>;
    additionalProperties: false;
};

function numberFilterSchema(key: string): FilterPropertySchema {
    if (key === 'minInferredConfidence') {
        return { type: 'number', ...MIN_INFERRED_CONFIDENCE_RANGE };
    }
    return { type: 'number' };
}

/**
 * The JSON schema of the `filters` object `parseSemanticProjectQueryInput` admits.
 *
 * Built from the parser's own key tables and bounds, so a filter added to the
 * parser is published here with it, and a published filter is never one the
 * parser refuses.
 */
export function getSemanticProjectQueryFiltersSchema(): SemanticProjectQueryFiltersSchema {
    const properties: Record<string, FilterPropertySchema> = {};
    for (const key of STRING_FILTER_KEYS) {
        properties[key] = { type: 'string', minLength: 1, maxLength: MAX_SEMANTIC_QUERY_FILTER_TEXT_LENGTH };
    }
    for (const key of BOOLEAN_FILTER_KEYS) {
        properties[key] = { type: 'boolean' };
    }
    for (const key of NUMBER_FILTER_KEYS) {
        properties[key] = numberFilterSchema(key);
    }
    properties.contentType = { type: 'string', enum: CONTENT_TYPE_FILTER_VALUES };
    return { type: 'object', properties, additionalProperties: false };
}
