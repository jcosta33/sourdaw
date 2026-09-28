import {
    DECLARATIVE_TRANSFORM_MAX_EMITTED_COMMANDS,
    DECLARATIVE_TRANSFORM_MAX_EXPRESSION_DEPTH,
    DECLARATIVE_TRANSFORM_MAX_SEED,
    DECLARATIVE_TRANSFORM_MAX_SELECTOR_LIMIT,
    DECLARATIVE_TRANSFORM_MAX_STEP_DEPTH,
    DECLARATIVE_TRANSFORM_MAX_VARIABLES,
    DECLARATIVE_TRANSFORM_MIN_SEED,
    DECLARATIVE_TRANSFORM_SCHEMA_VERSION,
    DECLARATIVE_TRANSFORM_UNITS,
} from '../models/DeclarativeTransform';

/** Provider guidance; parseDeclarativeTransformDocument is the runtime authority. */
export function getDeclarativeTransformDocumentSchema() {
    return {
        type: 'object',
        description: `Versioned, seeded data-only transform. Each selector has a limit up to ${String(DECLARATIVE_TRANSFORM_MAX_SELECTOR_LIMIT)}. Nest each/when steps at most ${String(DECLARATIVE_TRANSFORM_MAX_STEP_DEPTH)} levels, expressions and conditions at most ${String(DECLARATIVE_TRANSFORM_MAX_EXPRESSION_DEPTH)} levels, and emit at most ${String(DECLARATIVE_TRANSFORM_MAX_EMITTED_COMMANDS)} ordinary commands. Units: ${DECLARATIVE_TRANSFORM_UNITS.join(', ')}. No script or callback fields.`,
        properties: {
            schemaVersion: { type: 'integer', enum: [DECLARATIVE_TRANSFORM_SCHEMA_VERSION] },
            name: { type: 'string', minLength: 1, maxLength: 512 },
            seed: { type: 'integer', minimum: DECLARATIVE_TRANSFORM_MIN_SEED, maximum: DECLARATIVE_TRANSFORM_MAX_SEED },
            variables: {
                type: 'object',
                maxProperties: DECLARATIVE_TRANSFORM_MAX_VARIABLES,
                additionalProperties: { type: 'object' },
            },
            selectors: {
                type: 'object',
                additionalProperties: {
                    type: 'object',
                    properties: {
                        target: { type: 'string', enum: ['track', 'clip'] },
                        where: { type: 'object' },
                        limit: { type: 'integer', minimum: 1, maximum: DECLARATIVE_TRANSFORM_MAX_SELECTOR_LIMIT },
                    },
                    required: ['target', 'limit'],
                    additionalProperties: false,
                },
            },
            steps: { type: 'array', maxItems: 128, items: { type: 'object' } },
            assertions: { type: 'array', maxItems: 128, items: { type: 'object' } },
        },
        required: ['schemaVersion', 'name', 'seed', 'variables', 'selectors', 'steps', 'assertions'],
        additionalProperties: false,
    } as const;
}
