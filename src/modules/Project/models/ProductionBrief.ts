export const PRODUCTION_BRIEF_SCHEMA_VERSION = 1 as const;

export type ProductionBriefScope =
    | { kind: 'project' }
    | { kind: 'track'; trackId: string }
    | { kind: 'section'; sectionId: string }
    | { kind: 'object'; objectType: string; objectId: string }
    | { kind: 'range'; startBeat: number; endBeat: number }
    | { kind: 'decision'; decisionId: string };

export type ProductionBriefReference = {
    id: string;
    label: string;
    uri: string | null;
    assetHash: string | null;
    createdAt: number;
};

export type ProductionBriefStatement = {
    id: string;
    scope: ProductionBriefScope;
    statement: string;
    createdAt: number;
};

export type ProductionBriefSectionGoal = {
    id: string;
    sectionId: string;
    statement: string;
    createdAt: number;
};

export type ProductionBriefTrackRole = {
    id: string;
    trackId: string;
    role: string;
    createdAt: number;
};

export type ProductionBriefLock = ProductionBriefStatement;

export type ProductionDecisionStatus = 'accepted' | 'locked' | 'rejected' | 'superseded';

export type ProductionDecision = {
    id: string;
    scope: ProductionBriefScope;
    statement: string;
    rationale: string | null;
    status: ProductionDecisionStatus;
    sourceRunId: string | null;
    relatedBatchId: string | null;
    supersededByDecisionId: string | null;
    createdAt: number;
};

export type ProductionBriefQuestion = {
    id: string;
    statement: string;
    createdAt: number;
};

export type ProductionBriefSourceRunLink = {
    id: string;
    sourceRunId: string;
    createdAt: number;
};

export type ProductionBrief = {
    schemaVersion: typeof PRODUCTION_BRIEF_SCHEMA_VERSION;
    id: string;
    revision: number;
    vision: string | null;
    references: ProductionBriefReference[];
    hardConstraints: ProductionBriefStatement[];
    preferences: ProductionBriefStatement[];
    sectionGoals: ProductionBriefSectionGoal[];
    trackRoles: ProductionBriefTrackRole[];
    locks: ProductionBriefLock[];
    decisions: ProductionDecision[];
    unresolvedQuestions: ProductionBriefQuestion[];
    sourceRunLinks: ProductionBriefSourceRunLink[];
    supersedesBriefId: string | null;
    supersededByBriefId: string | null;
    createdAt: number;
    updatedAt: number;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNullableString(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
    const actualKeys = Object.keys(value);
    return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isScope(value: unknown): value is ProductionBriefScope {
    if (!isRecord(value) || typeof value.kind !== 'string') {
        return false;
    }
    if (value.kind === 'project') {
        return hasOnlyKeys(value, ['kind']);
    }
    if (value.kind === 'track') {
        return hasOnlyKeys(value, ['kind', 'trackId']) && isNonEmptyString(value.trackId);
    }
    if (value.kind === 'section') {
        return hasOnlyKeys(value, ['kind', 'sectionId']) && isNonEmptyString(value.sectionId);
    }
    if (value.kind === 'object') {
        return (
            hasOnlyKeys(value, ['kind', 'objectType', 'objectId']) &&
            isNonEmptyString(value.objectType) &&
            isNonEmptyString(value.objectId)
        );
    }
    if (value.kind === 'decision') {
        return hasOnlyKeys(value, ['kind', 'decisionId']) && isNonEmptyString(value.decisionId);
    }
    return (
        value.kind === 'range' &&
        hasOnlyKeys(value, ['kind', 'startBeat', 'endBeat']) &&
        typeof value.startBeat === 'number' &&
        Number.isFinite(value.startBeat) &&
        typeof value.endBeat === 'number' &&
        Number.isFinite(value.endBeat) &&
        value.endBeat > value.startBeat
    );
}

function isStatement(value: unknown): value is ProductionBriefStatement {
    return (
        isRecord(value) &&
        hasOnlyKeys(value, ['id', 'scope', 'statement', 'createdAt']) &&
        isNonEmptyString(value.id) &&
        isScope(value.scope) &&
        isNonEmptyString(value.statement) &&
        isFiniteNonNegative(value.createdAt)
    );
}

function hasUniqueIds(values: readonly { id: string }[]): boolean {
    return new Set(values.map((value) => value.id)).size === values.length;
}

export function isProductionBrief(value: unknown): value is ProductionBrief {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, [
            'schemaVersion',
            'id',
            'revision',
            'vision',
            'references',
            'hardConstraints',
            'preferences',
            'sectionGoals',
            'trackRoles',
            'locks',
            'decisions',
            'unresolvedQuestions',
            'sourceRunLinks',
            'supersedesBriefId',
            'supersededByBriefId',
            'createdAt',
            'updatedAt',
        ]) ||
        value.schemaVersion !== PRODUCTION_BRIEF_SCHEMA_VERSION ||
        !isNonEmptyString(value.id) ||
        typeof value.revision !== 'number' ||
        !Number.isInteger(value.revision) ||
        value.revision < 0 ||
        !isNullableString(value.vision) ||
        !isNullableString(value.supersedesBriefId) ||
        !isNullableString(value.supersededByBriefId) ||
        !isFiniteNonNegative(value.createdAt) ||
        !isFiniteNonNegative(value.updatedAt) ||
        value.updatedAt < value.createdAt ||
        !Array.isArray(value.references) ||
        !Array.isArray(value.hardConstraints) ||
        !Array.isArray(value.preferences) ||
        !Array.isArray(value.sectionGoals) ||
        !Array.isArray(value.trackRoles) ||
        !Array.isArray(value.locks) ||
        !Array.isArray(value.decisions) ||
        !Array.isArray(value.unresolvedQuestions) ||
        !Array.isArray(value.sourceRunLinks)
    ) {
        return false;
    }

    const references = value.references.filter(
        (reference): reference is ProductionBriefReference =>
            isRecord(reference) &&
            hasOnlyKeys(reference, ['id', 'label', 'uri', 'assetHash', 'createdAt']) &&
            isNonEmptyString(reference.id) &&
            isNonEmptyString(reference.label) &&
            isNullableString(reference.uri) &&
            isNullableString(reference.assetHash) &&
            isFiniteNonNegative(reference.createdAt)
    );
    const hardConstraints = value.hardConstraints.filter(isStatement);
    const preferences = value.preferences.filter(isStatement);
    const locks = value.locks.filter(isStatement);
    const sectionGoals = value.sectionGoals.filter(
        (goal): goal is ProductionBriefSectionGoal =>
            isRecord(goal) &&
            hasOnlyKeys(goal, ['id', 'sectionId', 'statement', 'createdAt']) &&
            isNonEmptyString(goal.id) &&
            isNonEmptyString(goal.sectionId) &&
            isNonEmptyString(goal.statement) &&
            isFiniteNonNegative(goal.createdAt)
    );
    const trackRoles = value.trackRoles.filter(
        (role): role is ProductionBriefTrackRole =>
            isRecord(role) &&
            hasOnlyKeys(role, ['id', 'trackId', 'role', 'createdAt']) &&
            isNonEmptyString(role.id) &&
            isNonEmptyString(role.trackId) &&
            isNonEmptyString(role.role) &&
            isFiniteNonNegative(role.createdAt)
    );
    const decisions = value.decisions.filter(
        (decision): decision is ProductionDecision =>
            isRecord(decision) &&
            hasOnlyKeys(decision, [
                'id',
                'scope',
                'statement',
                'rationale',
                'status',
                'sourceRunId',
                'relatedBatchId',
                'supersededByDecisionId',
                'createdAt',
            ]) &&
            isNonEmptyString(decision.id) &&
            isScope(decision.scope) &&
            isNonEmptyString(decision.statement) &&
            isNullableString(decision.rationale) &&
            ['accepted', 'locked', 'rejected', 'superseded'].includes(String(decision.status)) &&
            isNullableString(decision.sourceRunId) &&
            isNullableString(decision.relatedBatchId) &&
            isNullableString(decision.supersededByDecisionId) &&
            isFiniteNonNegative(decision.createdAt)
    );
    const unresolvedQuestions = value.unresolvedQuestions.filter(
        (question): question is ProductionBriefQuestion =>
            isRecord(question) &&
            hasOnlyKeys(question, ['id', 'statement', 'createdAt']) &&
            isNonEmptyString(question.id) &&
            isNonEmptyString(question.statement) &&
            isFiniteNonNegative(question.createdAt)
    );
    const sourceRunLinks = value.sourceRunLinks.filter(
        (link): link is ProductionBriefSourceRunLink =>
            isRecord(link) &&
            hasOnlyKeys(link, ['id', 'sourceRunId', 'createdAt']) &&
            isNonEmptyString(link.id) &&
            isNonEmptyString(link.sourceRunId) &&
            isFiniteNonNegative(link.createdAt)
    );
    const identified = [
        ...references,
        ...hardConstraints,
        ...preferences,
        ...sectionGoals,
        ...trackRoles,
        ...locks,
        ...decisions,
        ...unresolvedQuestions,
        ...sourceRunLinks,
    ];
    const decisionIds = new Set(decisions.map((decision) => decision.id));
    const decisionsHaveValidSupersession = decisions.every((decision) => {
        if (decision.status !== 'superseded') {
            return decision.supersededByDecisionId === null;
        }
        return (
            decision.supersededByDecisionId !== null &&
            decision.supersededByDecisionId !== decision.id &&
            decisionIds.has(decision.supersededByDecisionId)
        );
    });

    return (
        references.length === value.references.length &&
        hardConstraints.length === value.hardConstraints.length &&
        preferences.length === value.preferences.length &&
        sectionGoals.length === value.sectionGoals.length &&
        trackRoles.length === value.trackRoles.length &&
        locks.length === value.locks.length &&
        decisions.length === value.decisions.length &&
        unresolvedQuestions.length === value.unresolvedQuestions.length &&
        sourceRunLinks.length === value.sourceRunLinks.length &&
        decisionsHaveValidSupersession &&
        hasUniqueIds(identified)
    );
}

export function createDefaultProductionBrief(createdAt = Date.now()): ProductionBrief {
    return {
        schemaVersion: PRODUCTION_BRIEF_SCHEMA_VERSION,
        id: 'production-brief',
        revision: 0,
        vision: null,
        references: [],
        hardConstraints: [],
        preferences: [],
        sectionGoals: [],
        trackRoles: [],
        locks: [],
        decisions: [],
        unresolvedQuestions: [],
        sourceRunLinks: [],
        supersedesBriefId: null,
        supersededByBriefId: null,
        createdAt,
        updatedAt: createdAt,
    };
}
