export const SEMANTIC_PROJECT_QUERY_SCHEMA = 'sourdaw.semantic-project-query';
export const SEMANTIC_PROJECT_QUERY_SCHEMA_VERSION = 1;
export const MAX_SEMANTIC_QUERY_PAGE_SIZE = 50;

export type SemanticProjectQueryType =
    'project-summary' | 'selection' | 'object' | 'routing-graph' | 'section' | 'tempo' | 'history' | 'diff';

export type SemanticProjectQueryFilters = {
    stableId?: string;
    exactName?: string;
    fuzzyName?: string;
    kind?: string;
    tag?: string;
    role?: string;
    parentId?: string;
    startBeat?: number;
    endBeat?: number;
    sectionId?: string;
    selected?: boolean;
    locked?: boolean;
    muted?: boolean;
    soloed?: boolean;
    deviceType?: string;
    deviceCategory?: string;
    routeFromId?: string;
    routeToId?: string;
    hasAutomation?: boolean;
    contentType?: 'audio' | 'midi';
    assetType?: string;
    minInferredConfidence?: number;
};

export type SemanticProjectQueryInput = {
    type: SemanticProjectQueryType;
    filters?: SemanticProjectQueryFilters;
    page?: {
        limit?: number;
        cursor?: string;
    };
    sinceRevision?: string;
};

export type SemanticProjectRevision = {
    documentIdentityEpoch: number;
    mutationEpoch: number;
    documents: Array<{
        docId: string;
        heads: string[];
    }>;
};

export type SemanticQueryItem = {
    id: string;
    kind: string;
    name?: string;
    inferredConfidence?: number;
    [key: string]: unknown;
};

export type SemanticProjectQueryReceipt = {
    schema: typeof SEMANTIC_PROJECT_QUERY_SCHEMA;
    schemaVersion: typeof SEMANTIC_PROJECT_QUERY_SCHEMA_VERSION;
    projectId: string;
    projectSchemaVersion: number;
    revision: SemanticProjectRevision;
    revisionToken: string;
    queryType: SemanticProjectQueryType;
    page: {
        offset: number;
        limit: number;
        total: number;
    };
    items: SemanticQueryItem[];
    nextCursor: string | null;
    warnings: string[];
};

export type SemanticIndexDiagnostics = {
    tracks: number;
    sections: number;
    routing: number;
    automation: number;
    tempo: number;
    history: number;
    brief: number;
    selection: number;
};

export type SemanticIndexEntity = SemanticQueryItem & {
    signature: string;
    parentId?: string;
    startBeat?: number;
    endBeat?: number;
    tags: string[];
    roles: string[];
    selected: boolean;
    locked: boolean;
    muted?: boolean;
    soloed?: boolean;
    deviceTypes: string[];
    deviceCategories: string[];
    routeFromIds: string[];
    routeToIds: string[];
    hasAutomation: boolean;
    contentType?: 'audio' | 'midi';
    assetType?: string;
};

export type SemanticProjectIndexSnapshot = {
    entities: SemanticIndexEntity[];
    tracks: SemanticIndexEntity[];
    sections: SemanticIndexEntity[];
    routing: SemanticIndexEntity[];
    automation: SemanticIndexEntity[];
    tempo: SemanticIndexEntity[];
    history: SemanticIndexEntity[];
    selection: SemanticIndexEntity[];
    revisionToken: string;
    revision: SemanticProjectRevision;
};
