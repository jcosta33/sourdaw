import { PRODUCTION_BRIEF_OPERATIONS, PRODUCTION_BRIEF_SCHEMA_VERSION } from '../models/ProductionBrief';
import { SEMANTIC_PROJECT_QUERY_SCHEMA_VERSION, SEMANTIC_PROJECT_QUERY_TYPES } from '../models/SemanticProjectQuery';

export function getProjectProtocolContracts() {
    return {
        query: {
            id: 'query' as const,
            owner: 'Project' as const,
            schemaVersion: SEMANTIC_PROJECT_QUERY_SCHEMA_VERSION,
            capabilities: ['revision-bound-read', 'pagination', 'stable-object-identity', 'semantic-diff'] as const,
            operations: SEMANTIC_PROJECT_QUERY_TYPES.map((name) => ({
                name,
                version: String(SEMANTIC_PROJECT_QUERY_SCHEMA_VERSION),
                availability: 'available' as const,
            })),
            availability: 'available' as const,
            compatibility: {
                mode: 'reject-unsupported' as const,
                behavior: 'Reject unsupported query schemas; query receipts remain read-only evidence.',
                canonicalProjectRequiresCommandReplay: false as const,
            },
        },
        productionBrief: {
            id: 'production-brief' as const,
            owner: 'Project' as const,
            schemaVersion: PRODUCTION_BRIEF_SCHEMA_VERSION,
            capabilities: ['scoped-intent', 'locks', 'decisions', 'supersession'] as const,
            operations: PRODUCTION_BRIEF_OPERATIONS.map((name) => ({
                name,
                version: String(PRODUCTION_BRIEF_SCHEMA_VERSION),
                availability: 'available' as const,
            })),
            availability: 'available' as const,
            compatibility: {
                mode: 'read-only-preserve' as const,
                behavior: 'Validate the complete brief schema and preserve superseded briefs by identity.',
                canonicalProjectRequiresCommandReplay: false as const,
            },
        },
    };
}
