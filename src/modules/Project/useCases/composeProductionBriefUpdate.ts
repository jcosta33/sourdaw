import { CANONICAL_TRACK_ROLES } from '../models/CanonicalTrackRole';
import {
    isProductionBrief,
    type ProductionBrief,
    type ProductionBriefReference,
    type ProductionBriefSectionGoal,
    type ProductionBriefStatement,
    type ProductionBriefTrackRole,
} from '../models/ProductionBrief';
import {
    PRODUCTION_BRIEF_UPDATE_LIMITS,
    type ProductionBriefUpdate,
    type ProductionBriefUpdateField,
    type ProductionBriefUpdateScope,
    type ProductionBriefUpdateStatement,
} from '../models/ProductionBriefUpdate';

type ComposeInput = {
    brief: ProductionBrief;
    update: ProductionBriefUpdate;
    /** The ids the update may name; an entry naming anything else is refused, never dropped. */
    trackIds: readonly string[];
    sectionIds: readonly string[];
    sourceRunId: string | null;
    now: number;
    createId?: (prefix: string) => string;
};

export type ComposeProductionBriefUpdateResult =
    | { status: 'composed'; brief: ProductionBrief }
    | { status: 'refused'; field: ProductionBriefUpdateField; reason: string };

type Refusal = Extract<ComposeProductionBriefUpdateResult, { status: 'refused' }>;

const LIMITS = PRODUCTION_BRIEF_UPDATE_LIMITS;
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const LINK = /:\/\/|\bwww\./iu;

function defaultCreateId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}`;
}

function refuse(field: ProductionBriefUpdateField, reason: string): Refusal {
    return { status: 'refused', field, reason };
}

/** Folded whitespace and no control characters, so two spellings of one statement compare equal. */
function normalizeText(value: string): string {
    return value.replace(CONTROL_CHARACTERS, ' ').replaceAll(/\s+/gu, ' ').trim();
}

function readText(field: ProductionBriefUpdateField, value: string, maxLength: number): string | Refusal {
    const text = normalizeText(value);
    if (text.length === 0) {
        return refuse(field, `A ${field} entry is empty.`);
    }
    if (text.length > maxLength) {
        return refuse(field, `A ${field} entry is longer than ${String(maxLength)} characters.`);
    }
    if (LINK.test(text)) {
        return refuse(field, `A ${field} entry carries a link; the brief records words, not addresses.`);
    }
    return text;
}

function sameText(left: string, right: string): boolean {
    return left.toLowerCase() === right.toLowerCase();
}

function sameScope(left: ProductionBriefStatement['scope'], right: ProductionBriefUpdateScope): boolean {
    if (left.kind === 'track' && right.kind === 'track') {
        return left.trackId === right.trackId;
    }
    if (left.kind === 'section' && right.kind === 'section') {
        return left.sectionId === right.sectionId;
    }
    return left.kind === 'project' && right.kind === 'project';
}

function checkCount(field: ProductionBriefUpdateField, requested: number, existing: number): Refusal | null {
    if (requested > LIMITS.entriesPerFieldPerUpdate) {
        return refuse(field, `One request adds at most ${String(LIMITS.entriesPerFieldPerUpdate)} ${field} entries.`);
    }
    if (existing + requested > LIMITS.entriesPerFieldInBrief) {
        return refuse(field, `The brief holds at most ${String(LIMITS.entriesPerFieldInBrief)} ${field} entries.`);
    }
    return null;
}

type Composition = { input: ComposeInput; createdAt: number; createId: (prefix: string) => string };

function checkScope(field: ProductionBriefUpdateField, scope: ProductionBriefUpdateScope, input: ComposeInput) {
    if (scope.kind === 'track' && !input.trackIds.includes(scope.trackId)) {
        return refuse(field, `A ${field} entry names a track the project does not hold.`);
    }
    if (scope.kind === 'section' && !input.sectionIds.includes(scope.sectionId)) {
        return refuse(field, `A ${field} entry names a section the project does not hold.`);
    }
    return null;
}

function addStatements(
    field: 'hardConstraints' | 'preferences',
    existing: readonly ProductionBriefStatement[],
    requested: readonly ProductionBriefUpdateStatement[],
    composition: Composition
): ProductionBriefStatement[] | Refusal {
    const next = [...existing];
    for (const entry of requested) {
        const scopeRefusal = checkScope(field, entry.scope, composition.input);
        if (scopeRefusal !== null) {
            return scopeRefusal;
        }
        const statement = readText(field, entry.statement, LIMITS.statementMaxLength);
        if (typeof statement !== 'string') {
            return statement;
        }
        if (next.some((held) => sameScope(held.scope, entry.scope) && sameText(held.statement, statement))) {
            continue;
        }
        next.push({
            id: composition.createId(field === 'hardConstraints' ? 'constraint' : 'preference'),
            scope: structuredClone(entry.scope),
            statement,
            createdAt: composition.createdAt,
        });
    }
    return checkCount(field, next.length - existing.length, existing.length) ?? next;
}

function addSectionGoals(
    existing: readonly ProductionBriefSectionGoal[],
    requested: NonNullable<ProductionBriefUpdate['sectionGoals']>,
    composition: Composition
): ProductionBriefSectionGoal[] | Refusal {
    const next = [...existing];
    for (const entry of requested) {
        if (!composition.input.sectionIds.includes(entry.sectionId)) {
            return refuse('sectionGoals', 'A sectionGoals entry names a section the project does not hold.');
        }
        const statement = readText('sectionGoals', entry.statement, LIMITS.statementMaxLength);
        if (typeof statement !== 'string') {
            return statement;
        }
        if (next.some((held) => held.sectionId === entry.sectionId && sameText(held.statement, statement))) {
            continue;
        }
        next.push({
            id: composition.createId('section-goal'),
            sectionId: entry.sectionId,
            statement,
            createdAt: composition.createdAt,
        });
    }
    return checkCount('sectionGoals', next.length - existing.length, existing.length) ?? next;
}

/** A role the user set stays theirs: a request may add a role to an unassigned track, never replace one. */
function addTrackRoles(
    existing: readonly ProductionBriefTrackRole[],
    requested: NonNullable<ProductionBriefUpdate['trackRoles']>,
    composition: Composition
): ProductionBriefTrackRole[] | Refusal {
    const next = [...existing];
    const requestedTrackIds = new Set<string>();
    for (const entry of requested) {
        if (!composition.input.trackIds.includes(entry.trackId)) {
            return refuse('trackRoles', 'A trackRoles entry names a track the project does not hold.');
        }
        if (entry.role === 'unknown' || !CANONICAL_TRACK_ROLES.some((role) => role === entry.role)) {
            return refuse('trackRoles', 'A trackRoles entry names a role outside the canonical track roles.');
        }
        if (requestedTrackIds.has(entry.trackId)) {
            return refuse('trackRoles', 'A trackRoles entry names the same track twice.');
        }
        requestedTrackIds.add(entry.trackId);
        const held = next.filter((role) => role.trackId === entry.trackId);
        if (held.some((role) => role.role === entry.role)) {
            continue;
        }
        if (held.length > 0) {
            return refuse('trackRoles', 'A trackRoles entry would replace a role already set for that track.');
        }
        next.push({
            id: composition.createId('role'),
            trackId: entry.trackId,
            role: entry.role,
            createdAt: composition.createdAt,
        });
    }
    return checkCount('trackRoles', next.length - existing.length, existing.length) ?? next;
}

function addReferences(
    existing: readonly ProductionBriefReference[],
    requested: NonNullable<ProductionBriefUpdate['references']>,
    composition: Composition
): ProductionBriefReference[] | Refusal {
    const next = [...existing];
    for (const entry of requested) {
        const label = readText('references', entry.label, LIMITS.referenceLabelMaxLength);
        if (typeof label !== 'string') {
            return label;
        }
        if (next.some((held) => sameText(held.label, label))) {
            continue;
        }
        next.push({
            id: composition.createId('reference'),
            label,
            uri: null,
            assetHash: null,
            createdAt: composition.createdAt,
        });
    }
    return checkCount('references', next.length - existing.length, existing.length) ?? next;
}

function readVision(current: string | null, requested: string | undefined): string | null | Refusal {
    if (requested === undefined) {
        return current;
    }
    return readText('vision', requested, LIMITS.visionMaxLength);
}

type BriefIntent = Pick<
    ProductionBrief,
    'vision' | 'references' | 'hardConstraints' | 'preferences' | 'sectionGoals' | 'trackRoles'
>;

/** Every list only grows, so a change shows as a new vision or a longer list. */
function changesIntent(brief: ProductionBrief, intent: BriefIntent): boolean {
    return (
        intent.vision !== brief.vision ||
        intent.references.length !== brief.references.length ||
        intent.hardConstraints.length !== brief.hardConstraints.length ||
        intent.preferences.length !== brief.preferences.length ||
        intent.sectionGoals.length !== brief.sectionGoals.length ||
        intent.trackRoles.length !== brief.trackRoles.length
    );
}

function linkSourceRun(brief: ProductionBrief, composition: Composition): ProductionBrief['sourceRunLinks'] {
    const links = structuredClone(brief.sourceRunLinks);
    const { sourceRunId } = composition.input;
    if (sourceRunId === null || links.some((link) => link.sourceRunId === sourceRunId)) {
        return links;
    }
    return [...links, { id: composition.createId('source-run-link'), sourceRunId, createdAt: composition.createdAt }];
}

/**
 * The whole next brief one request's change composes, or the field that refuses it. Locks and
 * decisions are copied unchanged, so the handler's locked-intent check holds by construction; the
 * application mints every id and timestamp, and the result is checked as a brief before it is returned.
 */
export function composeProductionBriefUpdate(input: ComposeInput): ComposeProductionBriefUpdateResult {
    const { brief, update } = input;
    const composition: Composition = {
        input,
        createdAt: Math.max(input.now, brief.updatedAt),
        createId: input.createId ?? defaultCreateId,
    };
    const vision = readVision(brief.vision, update.vision);
    if (vision !== null && typeof vision !== 'string') {
        return vision;
    }
    const references = addReferences(brief.references, update.references ?? [], composition);
    if (!Array.isArray(references)) {
        return references;
    }
    const hardConstraints = addStatements(
        'hardConstraints',
        brief.hardConstraints,
        update.hardConstraints ?? [],
        composition
    );
    if (!Array.isArray(hardConstraints)) {
        return hardConstraints;
    }
    const preferences = addStatements('preferences', brief.preferences, update.preferences ?? [], composition);
    if (!Array.isArray(preferences)) {
        return preferences;
    }
    const sectionGoals = addSectionGoals(brief.sectionGoals, update.sectionGoals ?? [], composition);
    if (!Array.isArray(sectionGoals)) {
        return sectionGoals;
    }
    const trackRoles = addTrackRoles(brief.trackRoles, update.trackRoles ?? [], composition);
    if (!Array.isArray(trackRoles)) {
        return trackRoles;
    }
    const intent: BriefIntent = { vision, references, hardConstraints, preferences, sectionGoals, trackRoles };
    if (!changesIntent(brief, intent)) {
        return refuse('update', 'The requested change leaves the production brief as it is.');
    }
    const next: ProductionBrief = {
        ...structuredClone(brief),
        ...intent,
        revision: brief.revision + 1,
        sourceRunLinks: linkSourceRun(brief, composition),
        updatedAt: composition.createdAt,
    };
    if (!isProductionBrief(next)) {
        return refuse('update', 'The requested change does not compose a valid production brief.');
    }
    return { status: 'composed', brief: next };
}
