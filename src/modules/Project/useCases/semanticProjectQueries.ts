import { clipSelectionStore, markerStore, trackStore } from '#/modules/Arrangement/stores';

import { CURRENT_PROJECT_VERSION } from '../models/ProjectData';
import {
    MAX_SEMANTIC_QUERY_PAGE_SIZE,
    SEMANTIC_PROJECT_QUERY_SCHEMA,
    SEMANTIC_PROJECT_QUERY_SCHEMA_VERSION,
    type SemanticIndexEntity,
    type SemanticProjectIndexSnapshot,
    type SemanticProjectQueryFilters,
    type SemanticProjectQueryInput,
    type SemanticProjectQueryReceipt,
    type SemanticProjectRevision,
    type SemanticQueryItem,
} from '../models/SemanticProjectQuery';
import { projectStore } from '../stores/projectStore';

import { semanticProjectIndex } from './semanticProjectIndex';

const DEFAULT_PAGE_SIZE = 20;
const MAX_RETAINED_DIFF_REVISIONS = 32;
const MAX_NESTED_VALUES = 100;
const MAX_TEXT_LENGTH = 2_048;
const MAX_VALUE_DEPTH = 6;
const MAX_WARNINGS = 20;
const MAX_FILTER_TEXT_LENGTH = 256;
const MAX_REVISION_TOKEN_LENGTH = 65_536;
const QUERY_TYPES = [
    'project-summary',
    'selection',
    'object',
    'routing-graph',
    'section',
    'tempo',
    'history',
    'diff',
] as const;

type RetainedSnapshot = Map<string, { item: SemanticIndexEntity; signature: string }>;

const retainedSnapshots = new Map<string, RetainedSnapshot>();
let retainedProjectId: string | null = null;
let retainedDocumentIdentityEpoch: number | null = null;

function pushWarning(warnings: string[], warning: string): void {
    const boundedWarning = warning.slice(0, MAX_TEXT_LENGTH);
    if (warnings.length >= MAX_WARNINGS || warnings.includes(boundedWarning)) {
        return;
    }
    warnings.push(boundedWarning);
}

function assertSemanticProjectQueryInput(input: SemanticProjectQueryInput): void {
    if (!QUERY_TYPES.includes(input.type)) {
        throw new Error('Unsupported semantic project query type');
    }
    if (input.page?.cursor !== undefined && typeof input.page.cursor !== 'string') {
        throw new Error('Semantic query cursor must be a string');
    }
    if (input.page?.cursor && input.page.cursor.length > MAX_FILTER_TEXT_LENGTH) {
        throw new Error('Semantic query cursor is too long');
    }
    if (input.sinceRevision !== undefined && input.sinceRevision.length > MAX_REVISION_TOKEN_LENGTH) {
        throw new Error('Semantic query revision token is too long');
    }
    const filters = input.filters;
    if (!filters) {
        return;
    }
    const finiteValues = [
        ['startBeat', filters.startBeat],
        ['endBeat', filters.endBeat],
        ['minInferredConfidence', filters.minInferredConfidence],
    ] as const;
    for (const [name, value] of finiteValues) {
        if (value !== undefined && !Number.isFinite(value)) {
            throw new Error(`Semantic query filter ${name} must be finite`);
        }
    }
    if (filters.startBeat !== undefined && filters.endBeat !== undefined && filters.endBeat <= filters.startBeat) {
        throw new Error('Semantic query range must have positive duration');
    }
    if (
        filters.minInferredConfidence !== undefined &&
        (filters.minInferredConfidence < 0 || filters.minInferredConfidence > 1)
    ) {
        throw new Error('Semantic query confidence must be between 0 and 1');
    }
    for (const value of Object.values(filters)) {
        if (typeof value === 'string' && value.length > MAX_FILTER_TEXT_LENGTH) {
            throw new Error('Semantic query text filter is too long');
        }
    }
}

function normalizeText(value: string): string {
    return value
        .normalize('NFKD')
        .replaceAll(/[\u0300-\u036F]/g, '')
        .toLocaleLowerCase()
        .replaceAll(/[^a-z0-9]+/g, ' ')
        .trim();
}

function editDistance(left: string, right: string): number {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
        const current = [leftIndex];
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
            const substitution = previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
            current[rightIndex] = Math.min(previous[rightIndex]! + 1, current[rightIndex - 1]! + 1, substitution);
        }
        previous.splice(0, previous.length, ...current);
    }
    return previous[right.length] ?? 0;
}

function inferredNameConfidence(name: string | undefined, fuzzyName: string | undefined): number {
    if (!fuzzyName) {
        return 1;
    }
    if (!name) {
        return 0;
    }
    const normalizedName = normalizeText(name).slice(0, MAX_FILTER_TEXT_LENGTH);
    const normalizedQuery = normalizeText(fuzzyName).slice(0, MAX_FILTER_TEXT_LENGTH);
    if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) {
        return 1;
    }
    const longest = Math.max(normalizedName.length, normalizedQuery.length);
    return longest === 0 ? 1 : Math.max(0, 1 - editDistance(normalizedName, normalizedQuery) / longest);
}

function overlapsFilterRange(entity: SemanticIndexEntity, filters: SemanticProjectQueryFilters): boolean {
    if (filters.startBeat === undefined && filters.endBeat === undefined) {
        return true;
    }
    if (entity.startBeat === undefined || entity.endBeat === undefined) {
        return false;
    }
    const startBeat = filters.startBeat ?? Number.NEGATIVE_INFINITY;
    const endBeat = filters.endBeat ?? Number.POSITIVE_INFINITY;
    return entity.startBeat < endBeat && entity.endBeat >= startBeat;
}

function entityMatchesFilters(entity: SemanticIndexEntity, filters: SemanticProjectQueryFilters | undefined): boolean {
    if (!filters) {
        return true;
    }
    if (filters.stableId !== undefined && entity.id !== filters.stableId) {
        return false;
    }
    if (filters.exactName !== undefined && normalizeText(entity.name ?? '') !== normalizeText(filters.exactName)) {
        return false;
    }
    const confidence = inferredNameConfidence(entity.name, filters.fuzzyName);
    if (filters.fuzzyName !== undefined && confidence < (filters.minInferredConfidence ?? 0.6)) {
        return false;
    }
    if (filters.minInferredConfidence !== undefined && confidence < filters.minInferredConfidence) {
        return false;
    }
    if (filters.kind !== undefined && entity.kind !== filters.kind && entity.trackKind !== filters.kind) {
        return false;
    }
    if (filters.tag !== undefined && !entity.tags.includes(filters.tag)) {
        return false;
    }
    if (filters.role !== undefined && !entity.roles.includes(filters.role)) {
        return false;
    }
    if (filters.parentId !== undefined && entity.parentId !== filters.parentId) {
        return false;
    }
    if (!overlapsFilterRange(entity, filters)) {
        return false;
    }
    if (filters.sectionId !== undefined) {
        const section = markerStore.value?.sections.find((candidate) => candidate.id === filters.sectionId);
        if (
            !section ||
            entity.startBeat === undefined ||
            entity.endBeat === undefined ||
            entity.startBeat >= section.endBeat ||
            entity.endBeat < section.startBeat
        ) {
            return false;
        }
    }
    if (filters.selected !== undefined && entity.selected !== filters.selected) {
        return false;
    }
    if (filters.locked !== undefined && entity.locked !== filters.locked) {
        return false;
    }
    if (filters.muted !== undefined && entity.muted !== filters.muted) {
        return false;
    }
    if (filters.soloed !== undefined && entity.soloed !== filters.soloed) {
        return false;
    }
    if (filters.deviceType !== undefined && !entity.deviceTypes.includes(filters.deviceType)) {
        return false;
    }
    if (filters.deviceCategory !== undefined && !entity.deviceCategories.includes(filters.deviceCategory)) {
        return false;
    }
    if (filters.routeFromId !== undefined && !entity.routeFromIds.includes(filters.routeFromId)) {
        return false;
    }
    if (filters.routeToId !== undefined && !entity.routeToIds.includes(filters.routeToId)) {
        return false;
    }
    if (filters.hasAutomation !== undefined && entity.hasAutomation !== filters.hasAutomation) {
        return false;
    }
    if (filters.contentType !== undefined && entity.contentType !== filters.contentType) {
        return false;
    }
    if (filters.assetType !== undefined && entity.assetType !== filters.assetType) {
        return false;
    }
    return true;
}

function toQueryItem(entity: SemanticIndexEntity, filters?: SemanticProjectQueryFilters): SemanticQueryItem {
    const {
        signature: _signature,
        tags: _tags,
        deviceCategories: _deviceCategories,
        routeFromIds: _routeFromIds,
        routeToIds: _routeToIds,
        ...item
    } = entity;
    return {
        ...item,
        inferredConfidence: inferredNameConfidence(entity.name, filters?.fuzzyName),
    };
}

function boundedValues<TValue>(values: readonly TValue[], label: string, warnings: string[]): TValue[] {
    if (values.length > MAX_NESTED_VALUES) {
        pushWarning(warnings, `${label} was truncated to ${String(MAX_NESTED_VALUES)} entries.`);
    }
    return values.slice(0, MAX_NESTED_VALUES);
}

function createProjectSummary(snapshot: SemanticProjectIndexSnapshot, warnings: string[]): SemanticQueryItem {
    const project = projectStore.value;
    const transport = snapshot.tempo.find((item) => item.id === 'tempo-base');
    const rolesByTrack = new Map<string, string[]>();
    for (const role of project?.productionBrief.trackRoles ?? []) {
        rolesByTrack.set(role.trackId, [...(rolesByTrack.get(role.trackId) ?? []), role.role]);
    }
    const tracks = boundedValues(
        snapshot.tracks
            .filter((entity) => entity.kind === 'track')
            .map((entity) => ({
                id: entity.id,
                name: entity.name,
                kind: entity.trackKind,
                roles: rolesByTrack.get(entity.id) ?? [],
                deviceTypes: entity.deviceTypes,
                outputId: entity.outputId,
                sendBusIds: entity.sendBusIds,
                muted: entity.muted,
                soloed: entity.soloed,
                locked: entity.locked,
            })),
        'Project track summary',
        warnings
    );
    const unresolvedWarnings = boundedValues(
        project?.productionBrief.unresolvedQuestions ?? [],
        'Production brief warnings',
        warnings
    ).map((question) => question.statement);
    for (const warning of unresolvedWarnings) {
        pushWarning(warnings, warning);
    }
    return {
        id: String(project?.createdAt ?? 0),
        kind: 'project-summary',
        name: project?.name ?? 'Untitled Project',
        revision: snapshot.revision,
        tempo: transport?.tempo ?? 120,
        meter: transport?.meter ?? [4, 4],
        sections: boundedValues(
            snapshot.sections.filter((entity) => entity.kind === 'section'),
            'Project section summary',
            warnings
        ).map((entity) => ({
            id: entity.id,
            name: entity.name,
            startBeat: entity.startBeat,
            endBeat: entity.endBeat,
        })),
        selection: {
            trackId: trackStore.value?.selectedTrackId ?? null,
            clipIds: boundedValues(
                [
                    ...new Set([
                        ...(clipSelectionStore.value?.selectedClipIds ?? []),
                        ...(clipSelectionStore.value?.selectedClipId ? [clipSelectionStore.value.selectedClipId] : []),
                    ]),
                ],
                'Selected clips',
                warnings
            ),
        },
        tracks,
        locks: structuredClone(boundedValues(project?.productionBrief.locks ?? [], 'Production locks', warnings)),
        decisions: structuredClone(
            boundedValues(project?.productionBrief.decisions ?? [], 'Production decisions', warnings)
        ),
        warnings: [...warnings],
    };
}

function createSectionItems(
    snapshot: SemanticProjectIndexSnapshot,
    filters: SemanticProjectQueryFilters | undefined,
    warnings: string[]
): SemanticQueryItem[] {
    return snapshot.sections
        .filter((entity) => entity.kind === 'section')
        .filter((entity) => filters?.sectionId === undefined || entity.id === filters.sectionId)
        .filter((entity) => entityMatchesFilters(entity, filters))
        .map((section) => {
            const startBeat = section.startBeat ?? 0;
            const endBeat = section.endBeat ?? startBeat;
            function overlaps(entity: SemanticIndexEntity): boolean {
                return (
                    entity.startBeat !== undefined &&
                    entity.endBeat !== undefined &&
                    entity.startBeat < endBeat &&
                    entity.endBeat >= startBeat
                );
            }
            return {
                ...toQueryItem(section, filters),
                trackIds: boundedValues(
                    [
                        ...new Set(
                            snapshot.tracks
                                .filter((entity) => entity.kind === 'clip' && overlaps(entity))
                                .map((entity) => entity.parentId)
                                .filter((id): id is string => Boolean(id))
                        ),
                    ],
                    'Section track IDs',
                    warnings
                ),
                clipIds: boundedValues(
                    snapshot.tracks
                        .filter((entity) => entity.kind === 'clip' && overlaps(entity))
                        .map((entity) => entity.id),
                    'Section clip IDs',
                    warnings
                ),
                automationLaneIds: boundedValues(
                    snapshot.automation.filter(overlaps).map((entity) => entity.id),
                    'Section automation lanes',
                    warnings
                ),
                markerIds: boundedValues(
                    snapshot.sections
                        .filter((entity) => entity.kind === 'marker' && overlaps(entity))
                        .map((entity) => entity.id),
                    'Section markers',
                    warnings
                ),
            };
        });
}

function createSelectionItems(snapshot: SemanticProjectIndexSnapshot): SemanticQueryItem[] {
    return snapshot.tracks
        .filter((entity) => entity.selected)
        .toSorted((left, right) => {
            if (left.kind === right.kind) {
                return left.id.localeCompare(right.id);
            }
            return left.kind === 'track' ? -1 : 1;
        })
        .map((entity) => toQueryItem(entity));
}

function rememberSnapshot(snapshot: SemanticProjectIndexSnapshot): void {
    const retained = new Map<string, { item: SemanticIndexEntity; signature: string }>();
    for (const entity of snapshot.entities) {
        retained.set(`${entity.kind}:${entity.id}`, { item: entity, signature: entity.signature });
    }
    retainedSnapshots.delete(snapshot.revisionToken);
    retainedSnapshots.set(snapshot.revisionToken, retained);
    while (retainedSnapshots.size > MAX_RETAINED_DIFF_REVISIONS) {
        const oldest = retainedSnapshots.keys().next().value;
        if (typeof oldest !== 'string') {
            break;
        }
        retainedSnapshots.delete(oldest);
    }
}

function resetRetentionForProject(snapshot: SemanticProjectIndexSnapshot): void {
    const projectId = String(projectStore.value?.createdAt ?? 0);
    if (retainedProjectId === projectId && retainedDocumentIdentityEpoch === snapshot.revision.documentIdentityEpoch) {
        return;
    }
    retainedSnapshots.clear();
    retainedProjectId = projectId;
    retainedDocumentIdentityEpoch = snapshot.revision.documentIdentityEpoch;
}

function createDiffItems(
    snapshot: SemanticProjectIndexSnapshot,
    sinceRevision: string | undefined,
    warnings: string[]
): SemanticQueryItem[] {
    if (!sinceRevision) {
        throw new Error('A diff query requires sinceRevision');
    }
    const before = retainedSnapshots.get(sinceRevision);
    if (!before) {
        warnings.push('The requested revision is outside the retained semantic diff window.');
        return [];
    }
    const current = new Map(snapshot.entities.map((entity) => [`${entity.kind}:${entity.id}`, entity]));
    const changes: SemanticQueryItem[] = [];
    for (const [key, entity] of current) {
        const previous = before.get(key);
        if (!previous) {
            changes.push({ id: entity.id, kind: entity.kind, change: 'added' });
            continue;
        }
        if (previous.signature !== entity.signature) {
            changes.push({ id: entity.id, kind: entity.kind, change: 'updated' });
        }
    }
    for (const [key, previous] of before) {
        if (!current.has(key)) {
            changes.push({ id: previous.item.id, kind: previous.item.kind, change: 'removed' });
        }
    }
    return changes.toSorted((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
}

function selectItems(
    input: SemanticProjectQueryInput,
    snapshot: SemanticProjectIndexSnapshot,
    warnings: string[]
): SemanticQueryItem[] {
    if (input.type === 'project-summary') {
        return [createProjectSummary(snapshot, warnings)];
    }
    if (input.type === 'selection') {
        return createSelectionItems(snapshot).filter((item) => {
            const entity = snapshot.entities.find(
                (candidate) => candidate.id === item.id && candidate.kind === item.kind
            );
            return entity ? entityMatchesFilters(entity, input.filters) : false;
        });
    }
    if (input.type === 'routing-graph') {
        return snapshot.routing
            .filter((entity) => entityMatchesFilters(entity, input.filters))
            .map((entity) => toQueryItem(entity));
    }
    if (input.type === 'section') {
        return createSectionItems(snapshot, input.filters, warnings);
    }
    if (input.type === 'tempo') {
        return snapshot.tempo
            .filter((entity) => entityMatchesFilters(entity, input.filters))
            .map((entity) => toQueryItem(entity));
    }
    if (input.type === 'history') {
        return snapshot.history
            .filter((entity) => entityMatchesFilters(entity, input.filters))
            .map((entity) => toQueryItem(entity));
    }
    if (input.type === 'diff') {
        return createDiffItems(snapshot, input.sinceRevision, warnings);
    }
    return snapshot.entities
        .filter(
            (entity) =>
                entity.kind !== 'output-route' &&
                entity.kind !== 'send' &&
                entity.kind !== 'sidechain-route' &&
                entity.kind !== 'tempo' &&
                entity.kind !== 'tempo-change' &&
                entity.kind !== 'meter-change' &&
                entity.kind !== 'history-entry'
        )
        .filter((entity) => entityMatchesFilters(entity, input.filters))
        .map((entity) => toQueryItem(entity, input.filters));
}

function hashString(value: string): string {
    let hash = 2_166_136_261;
    for (const character of value) {
        hash ^= character.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 16_777_619);
    }
    return (hash >>> 0).toString(36);
}

function queryFingerprint(input: SemanticProjectQueryInput, revisionToken: string): string {
    return hashString(
        JSON.stringify({
            schemaVersion: SEMANTIC_PROJECT_QUERY_SCHEMA_VERSION,
            revisionToken,
            type: input.type,
            filters: input.filters ?? null,
            sinceRevision: input.sinceRevision ?? null,
        })
    );
}

function getPage(input: SemanticProjectQueryInput, revisionToken: string): { offset: number; limit: number } {
    const limit = input.page?.limit ?? DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEMANTIC_QUERY_PAGE_SIZE) {
        throw new Error(`Semantic query page limit must be between 1 and ${String(MAX_SEMANTIC_QUERY_PAGE_SIZE)}`);
    }
    const cursor = input.page?.cursor;
    if (!cursor) {
        return { offset: 0, limit };
    }
    const [version, fingerprint, offsetText, extra] = cursor.split('.');
    const offset = Number(offsetText);
    if (
        version !== 'v1' ||
        fingerprint !== queryFingerprint(input, revisionToken) ||
        extra !== undefined ||
        !Number.isInteger(offset) ||
        offset < 0
    ) {
        throw new Error('Invalid or stale semantic query cursor');
    }
    return { offset, limit };
}

function boundValue(value: unknown, warnings: string[], path: string, depth: number): unknown {
    if (typeof value === 'string') {
        if (value.length <= MAX_TEXT_LENGTH) {
            return value;
        }
        pushWarning(warnings, `${path} text was truncated.`);
        return value.slice(0, MAX_TEXT_LENGTH);
    }
    if (typeof value === 'number') {
        if (Number.isFinite(value)) {
            return value;
        }
        pushWarning(warnings, `${path} contained a non-finite number.`);
        return null;
    }
    if (value === null || typeof value === 'boolean' || value === undefined) {
        return value;
    }
    if (depth >= MAX_VALUE_DEPTH) {
        pushWarning(warnings, `${path} exceeded the semantic receipt depth limit.`);
        return null;
    }
    if (Array.isArray(value)) {
        const values = boundedValues(value, path, warnings);
        return values.map((item, index) => boundValue(item, warnings, `${path}[${String(index)}]`, depth + 1));
    }
    if (typeof value !== 'object') {
        return null;
    }
    const entries = Object.entries(value);
    if (entries.length > MAX_NESTED_VALUES) {
        pushWarning(warnings, `${path} was truncated to ${String(MAX_NESTED_VALUES)} fields.`);
    }
    const bounded: Record<string, unknown> = {};
    for (const [key, item] of entries.slice(0, MAX_NESTED_VALUES)) {
        bounded[key] = boundValue(item, warnings, `${path}.${key}`, depth + 1);
    }
    return bounded;
}

function boundQueryItem(item: SemanticQueryItem, warnings: string[]): SemanticQueryItem {
    const bounded: SemanticQueryItem = {
        id: String(boundValue(item.id, warnings, 'item.id', 0)),
        kind: String(boundValue(item.kind, warnings, 'item.kind', 0)),
    };
    for (const [key, value] of Object.entries(item)) {
        if (key === 'id' || key === 'kind') {
            continue;
        }
        bounded[key] = boundValue(value, warnings, `item.${key}`, 0);
    }
    return bounded;
}

function boundRevision(revision: SemanticProjectRevision, warnings: string[]): SemanticProjectRevision {
    return {
        documentIdentityEpoch: revision.documentIdentityEpoch,
        mutationEpoch: revision.mutationEpoch,
        documents: boundedValues(revision.documents, 'Automerge documents', warnings).map((document) => ({
            docId: document.docId.slice(0, MAX_TEXT_LENGTH),
            heads: boundedValues(document.heads, `Automerge heads for ${document.docId}`, warnings).map((head) =>
                head.slice(0, MAX_TEXT_LENGTH)
            ),
        })),
    };
}

export function querySemanticProject(input: SemanticProjectQueryInput): SemanticProjectQueryReceipt {
    assertSemanticProjectQueryInput(input);
    const snapshot = semanticProjectIndex.read();
    resetRetentionForProject(snapshot);
    const warnings: string[] = [];
    const items = selectItems(input, snapshot, warnings);
    const page = getPage(input, snapshot.revisionToken);
    const pagedItems = items.slice(page.offset, page.offset + page.limit).map((item) => boundQueryItem(item, warnings));
    const nextOffset = page.offset + page.limit;
    const nextCursor =
        nextOffset < items.length
            ? `v1.${queryFingerprint(input, snapshot.revisionToken)}.${String(nextOffset)}`
            : null;
    rememberSnapshot(snapshot);
    return {
        schema: SEMANTIC_PROJECT_QUERY_SCHEMA,
        schemaVersion: SEMANTIC_PROJECT_QUERY_SCHEMA_VERSION,
        projectId: String(projectStore.value?.createdAt ?? 0),
        projectSchemaVersion: CURRENT_PROJECT_VERSION,
        revision: boundRevision(snapshot.revision, warnings),
        revisionToken: snapshot.revisionToken,
        queryType: input.type,
        page: {
            offset: page.offset,
            limit: page.limit,
            total: items.length,
        },
        items: pagedItems,
        nextCursor,
        warnings,
    };
}
