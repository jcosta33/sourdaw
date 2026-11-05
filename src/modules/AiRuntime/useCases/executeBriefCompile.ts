import { projectStore } from '#/modules/Project/stores';
import { composeProductionBriefUpdate, describeProductionBriefChange } from '#/modules/Project/useCases';

import { BRIEF_COMPILE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type ProjectContext } from '../models/ProjectContext';
import { type RetainedCommand } from '../models/RetainedCompilation';
import { type ToolCallResult } from '../transformers/toolCallParser';

import { compilePerceptualConstraints } from './perceptualConstraints/compilePerceptualConstraints';

type BriefUpdate = Parameters<typeof composeProductionBriefUpdate>[0]['update'];
type BriefStatement = NonNullable<BriefUpdate['preferences']>[number];

type BriefCompileResult = {
    receipt: ApplicationToolReceipt;
    commands: readonly RetainedCommand[] | null;
    briefChangeLines: readonly string[] | null;
};

type Parsed = { status: 'parsed'; update: BriefUpdate } | { status: 'invalid'; reason: string };

const UPDATE_KEYS = new Set(['vision', 'references', 'preferences', 'sectionGoals', 'trackRoles']);

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).every((key) => keys.includes(key));
}

function isText(value: unknown): value is string {
    return typeof value === 'string';
}

/**
 * An absent list is no change; anything else must be an array whose every entry is a record holding
 * only these keys and reads as one entry, or the whole list is refused.
 */
function readEntries<Entry>(
    value: unknown,
    keys: readonly string[],
    read: (entry: Record<string, unknown>) => Entry | null
): Entry[] | null {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        return null;
    }
    const entries: Entry[] = [];
    for (const candidate of value) {
        const entry = isRecord(candidate) && hasOnlyKeys(candidate, keys) ? read(candidate) : null;
        if (entry === null) {
            return null;
        }
        entries.push(entry);
    }
    return entries;
}

function readReference(entry: Record<string, unknown>): { label: string } | null {
    if (!isText(entry.label)) {
        return null;
    }
    return { label: entry.label };
}

function readSectionGoal(entry: Record<string, unknown>): { sectionId: string; statement: string } | null {
    if (!isText(entry.sectionId) || !isText(entry.statement)) {
        return null;
    }
    return { sectionId: entry.sectionId, statement: entry.statement };
}

function readTrackRole(entry: Record<string, unknown>): { trackId: string; role: string } | null {
    if (!isText(entry.trackId) || !isText(entry.role)) {
        return null;
    }
    return { trackId: entry.trackId, role: entry.role };
}

function readPreference(entry: Record<string, unknown>): BriefStatement | null {
    const { trackId, sectionId, statement } = withoutNulls(entry);
    if (!isText(statement) || (trackId !== undefined && !isText(trackId))) {
        return null;
    }
    if ((sectionId !== undefined && !isText(sectionId)) || (trackId !== undefined && sectionId !== undefined)) {
        return null;
    }
    if (isText(trackId)) {
        return { scope: { kind: 'track', trackId }, statement };
    }
    if (isText(sectionId)) {
        return { scope: { kind: 'section', sectionId }, statement };
    }
    return { scope: { kind: 'project' }, statement };
}

/** A strict reply states every optional property, as `null` when it means none. */
function withoutNulls(value: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null));
}

function parseBriefUpdate(provided: Record<string, unknown>): Parsed {
    const args = withoutNulls(provided);
    if (Object.keys(args).some((key) => !UPDATE_KEYS.has(key))) {
        return {
            status: 'invalid',
            reason: 'brief.compile takes only vision, references, preferences, sectionGoals and trackRoles.',
        };
    }
    if (args.vision !== undefined && !isText(args.vision)) {
        return { status: 'invalid', reason: 'vision: a vision is one string.' };
    }
    const references = readEntries(args.references, ['label'], readReference);
    if (references === null) {
        return { status: 'invalid', reason: 'references: each reference is an object with one label string.' };
    }
    const preferences = readEntries(args.preferences, ['trackId', 'sectionId', 'statement'], readPreference);
    if (preferences === null) {
        return {
            status: 'invalid',
            reason: 'preferences: each preference states a statement and at most one of trackId or sectionId.',
        };
    }
    const sectionGoals = readEntries(args.sectionGoals, ['sectionId', 'statement'], readSectionGoal);
    if (sectionGoals === null) {
        return { status: 'invalid', reason: 'sectionGoals: each section goal names a sectionId and a statement.' };
    }
    const trackRoles = readEntries(args.trackRoles, ['trackId', 'role'], readTrackRole);
    if (trackRoles === null) {
        return { status: 'invalid', reason: 'trackRoles: each track role names a trackId and a role.' };
    }
    const update: BriefUpdate = { references, preferences, sectionGoals, trackRoles };
    if (isText(args.vision)) {
        update.vision = args.vision;
    }
    return { status: 'parsed', update };
}

/**
 * The request's own protective clauses, as the perceptual constraint reader resolved them: the
 * application writes these, never provider text, so a hard constraint in the brief always names
 * what the request said and the objects it said it about.
 */
function readRequestHardConstraints(prompt: string, context: ProjectContext): BriefStatement[] {
    return compilePerceptualConstraints(prompt, context).constraints.flatMap((constraint): BriefStatement[] => {
        if (constraint.scope.kind === 'mix') {
            return [{ scope: { kind: 'project' }, statement: constraint.clause }];
        }
        return constraint.scope.trackIds.map((trackId) => ({
            scope: { kind: 'track', trackId },
            statement: constraint.clause,
        }));
    });
}

/**
 * One `brief.compile` call as the loop sees it. It composes the whole next brief from the live
 * project's brief, the provider's requested additions and the request's own protective clauses, and
 * retains it as one `setProductionBrief` the user confirms alone. It refuses unless the run's
 * interpretation admitted a brief request, and every other refusal names the field a provider can
 * correct.
 */
export function executeBriefCompile(input: {
    call: ToolCallResult;
    callId: string;
    turn: number;
    revision: string;
    prompt: string;
    context: ProjectContext;
    sourceRunId: string | null;
    /** Whether this request was offered the brief at all: only a hosted chat request is. */
    isBriefOffered: boolean;
    isBriefRequested: () => boolean;
}): BriefCompileResult {
    const { callId, turn, revision } = input;
    const failure = (code: string, reason: string, retryable: boolean): BriefCompileResult => ({
        commands: null,
        briefChangeLines: null,
        receipt: {
            schema: 'sourdaw.application-tool-receipt',
            schemaVersion: 1,
            callId,
            toolName: BRIEF_COMPILE_TOOL_NAME,
            turn,
            status: 'failure',
            revision,
            data: null,
            summary: reason,
            warnings: [],
            error: { code, safeMessage: reason, retryable },
        },
    });
    if (!input.isBriefOffered) {
        return failure(
            'brief-not-requested',
            'brief.compile is offered only to a hosted chat request; this request cannot write the production brief.',
            false
        );
    }
    if (!input.isBriefRequested()) {
        return failure(
            'brief-not-requested',
            'brief.compile writes the production brief only for a request whose interpretation selected mode brief.',
            false
        );
    }
    const parsed = parseBriefUpdate(input.call.arguments);
    if (parsed.status === 'invalid') {
        return failure('invalid-tool-arguments', parsed.reason, true);
    }
    const before = projectStore.value?.productionBrief;
    if (before === undefined || before.revision !== input.context.productionBrief?.revision) {
        return failure('stale-production-brief', 'The production brief changed while this request was planned.', false);
    }
    const composed = composeProductionBriefUpdate({
        brief: before,
        update: { ...parsed.update, hardConstraints: readRequestHardConstraints(input.prompt, input.context) },
        trackIds: input.context.tracks.map((track) => track.id),
        sectionIds: (input.context.sections ?? []).map((section) => section.id),
        sourceRunId: input.sourceRunId,
        now: Date.now(),
    });
    if (composed.status === 'refused') {
        return failure('invalid-tool-arguments', `${composed.field}: ${composed.reason}`, true);
    }
    const changeLines = describeProductionBriefChange({
        before,
        after: composed.brief,
        trackNames: Object.fromEntries(input.context.tracks.map((track) => [track.id, track.name])),
        sectionNames: Object.fromEntries((input.context.sections ?? []).map((section) => [section.id, section.name])),
    });
    if (changeLines === null) {
        return failure('invalid-tool-arguments', 'update: the composed brief could not be described.', false);
    }
    const command: RetainedCommand = {
        key: `${callId}:brief`,
        stepId: 'brief',
        operation: 'setProductionBrief',
        arguments: { expectedRevision: before.revision, brief: composed.brief },
        reason: 'Record the project intent the request describes in the production brief.',
        expectedEffect: `The production brief moves to revision ${String(composed.brief.revision)}.`,
        binding: null,
        dependencyKeys: [],
    };
    return {
        commands: [command],
        briefChangeLines: changeLines,
        receipt: {
            schema: 'sourdaw.application-tool-receipt',
            schemaVersion: 1,
            callId,
            toolName: BRIEF_COMPILE_TOOL_NAME,
            turn,
            status: 'success',
            revision,
            data: { schema: 'sourdaw.brief-compile', schemaVersion: 1, changes: changeLines },
            summary: `Composed production brief revision ${String(composed.brief.revision)}; propose this callId alone.`,
            warnings: [],
            error: null,
        },
    };
}
