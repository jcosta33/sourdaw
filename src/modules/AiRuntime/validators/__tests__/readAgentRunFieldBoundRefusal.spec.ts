import { describe, expect, it } from 'vitest';

import { AGENT_CONTEXT_SCHEMA_VERSION, type AgentContextEvidence } from '../../models/AgentContext';
import { MAX_COLLECTION_LENGTH } from '../../models/AgentRunPlanBounds';
import { type AgentRunBoundSubject, readAgentRunFieldBoundRefusal } from '../readAgentRunFieldBoundRefusal';

const BOUND = MAX_COLLECTION_LENGTH;

const emptyScope = { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] };
const emptyGrants = {
    allowedOperationPrefixes: [],
    create: false,
    delete: false,
    routing: false,
    tempo: false,
    master: false,
    file: false,
    audioUpload: false,
    remoteGeneration: false,
    autoCommit: false,
};
const emptyBudgets = { limits: {}, consumed: {} };

const evidence: AgentContextEvidence = {
    schemaVersion: AGENT_CONTEXT_SCHEMA_VERSION,
    revision: null,
    selection: { trackId: null, clipId: null, clipIds: [] },
    grants: null,
    budgets: null,
    included: {
        receiptCount: 0,
        capabilitySchemaCount: 0,
        validationFailures: { total: 0, retained: 0, omitted: 0 },
        measurementCount: 0,
        trackCount: 0,
    },
    snapshot: {
        identity: 'identity',
        tempo: 120,
        timeSignature: [4, 4],
        masterGain: 1,
        masterGainDb: 0,
        selectedTrack: null,
        selectableTargets: [],
        automationLanes: [],
        targetCount: 0,
        truncated: false,
    },
    delta: { mode: 'full', baseRevision: null, currentRevision: null },
};

const base: AgentRunBoundSubject = {
    scope: emptyScope,
    grants: emptyGrants,
    budgets: emptyBudgets,
    budgetAttempts: [],
    manualResume: { required: false, reason: null, workIds: [], requiredAt: null },
    contextEvidence: null,
    decision: null,
    resume: null,
    saga: { steps: [] },
    batches: [],
    receipts: [],
    renders: [],
    analyses: [],
    providerUsage: [],
    errors: [],
    committedWork: [],
    retriableWork: [],
    temporaryAssets: [],
    pendingEffectContinuations: [],
    preparedStemImports: [],
    workLeases: [],
};

function filled(count: number): string[] {
    return Array.from({ length: count }, (_, index) => `entry-${String(index)}`);
}

function keyed(count: number): Record<string, number> {
    return Object.fromEntries(filled(count).map((key) => [key, 1]));
}

function ranges(count: number) {
    return Array.from({ length: count }, (_, index) => ({ startBeat: index, endBeat: index + 1 }));
}

const attempt = {
    attemptId: 'attempt',
    category: 'remoteTokens',
    reserved: 1,
    actual: 0,
    provenance: 'versioned-estimate',
    final: false,
} as const;

const alternative = { id: 'alternative', label: 'Alternative', changesAuthority: false };

function decisionWith(overrides: Partial<NonNullable<AgentRunBoundSubject['decision']>>) {
    return { scope: emptyScope, grants: emptyGrants, budgets: emptyBudgets, alternatives: [], ...overrides };
}

function evidenceWith(snapshot: Partial<AgentContextEvidence['snapshot']>, rest: Partial<AgentContextEvidence> = {}) {
    return { ...evidence, ...rest, snapshot: { ...evidence.snapshot, ...snapshot } };
}

const target = { id: 'target', digest: 'digest' };

type Row = [string, (count: number) => AgentRunBoundSubject];

const collectionKeys = [
    'batches',
    'receipts',
    'renders',
    'analyses',
    'providerUsage',
    'errors',
    'committedWork',
    'retriableWork',
    'temporaryAssets',
    'pendingEffectContinuations',
    'preparedStemImports',
    'workLeases',
] as const;

const rows: Row[] = [
    ...collectionKeys.map((key): Row => [key, (count) => ({ ...base, [key]: filled(count) })]),
    ['scope.targetIds', (count) => ({ ...base, scope: { ...emptyScope, targetIds: filled(count) } })],
    ['scope.targetRanges', (count) => ({ ...base, scope: { ...emptyScope, targetRanges: ranges(count) } })],
    ['scope.protectedTargetIds', (count) => ({ ...base, scope: { ...emptyScope, protectedTargetIds: filled(count) } })],
    ['scope.protectedRanges', (count) => ({ ...base, scope: { ...emptyScope, protectedRanges: ranges(count) } })],
    [
        'grants.allowedOperationPrefixes',
        (count) => ({ ...base, grants: { ...emptyGrants, allowedOperationPrefixes: filled(count) } }),
    ],
    ['budgets.limits', (count) => ({ ...base, budgets: { limits: keyed(count), consumed: {} } })],
    ['budgets.consumed', (count) => ({ ...base, budgets: { limits: {}, consumed: keyed(count) } })],
    ['budgetAttempts', (count) => ({ ...base, budgetAttempts: Array.from({ length: count }, () => attempt) })],
    ['manualResume.workIds', (count) => ({ ...base, manualResume: { ...base.manualResume, workIds: filled(count) } })],
    ['saga.steps', (count) => ({ ...base, saga: { steps: filled(count) } })],
    [
        'decision.alternatives',
        (count) => ({
            ...base,
            decision: decisionWith({ alternatives: Array.from({ length: count }, () => alternative) }),
        }),
    ],
    [
        'decision.scope.targetRanges',
        (count) => ({ ...base, decision: decisionWith({ scope: { ...emptyScope, targetRanges: ranges(count) } }) }),
    ],
    [
        'decision.grants.allowedOperationPrefixes',
        (count) => ({
            ...base,
            decision: decisionWith({ grants: { ...emptyGrants, allowedOperationPrefixes: filled(count) } }),
        }),
    ],
    [
        'decision.budgets.consumed',
        (count) => ({ ...base, decision: decisionWith({ budgets: { limits: {}, consumed: keyed(count) } }) }),
    ],
    [
        'resume.scope.protectedTargetIds',
        (count) => ({
            ...base,
            resume: {
                scope: { ...emptyScope, protectedTargetIds: filled(count) },
                grants: emptyGrants,
                budgets: emptyBudgets,
            },
        }),
    ],
    [
        'contextEvidence.selection.clipIds',
        (count) => ({
            ...base,
            contextEvidence: { ...evidence, selection: { ...evidence.selection, clipIds: filled(count) } },
        }),
    ],
    [
        'contextEvidence.snapshot.selectableTargets',
        (count) => ({
            ...base,
            contextEvidence: evidenceWith({ selectableTargets: Array.from({ length: count }, () => target) }),
        }),
    ],
    [
        'contextEvidence.snapshot.automationLanes',
        (count) => ({
            ...base,
            contextEvidence: evidenceWith({ automationLanes: Array.from({ length: count }, () => target) }),
        }),
    ],
    [
        'contextEvidence.snapshot.sections',
        (count) => ({
            ...base,
            contextEvidence: evidenceWith({ sections: Array.from({ length: count }, () => target) }),
        }),
    ],
    [
        'contextEvidence.grants.allowedOperationPrefixes',
        (count) => ({
            ...base,
            contextEvidence: { ...evidence, grants: { ...emptyGrants, allowedOperationPrefixes: filled(count) } },
        }),
    ],
    [
        'contextEvidence.budgets.limits',
        (count) => ({
            ...base,
            contextEvidence: { ...evidence, budgets: { limits: keyed(count), consumed: {} } },
        }),
    ],
];

describe('readAgentRunFieldBoundRefusal', () => {
    it('admits a run holding nothing', () => {
        expect(readAgentRunFieldBoundRefusal(base)).toBeNull();
    });

    it.each(rows)('run.%s admits the bound and refuses one past it, naming the field', (name, build) => {
        expect(readAgentRunFieldBoundRefusal(build(BOUND))).toBeNull();
        expect(readAgentRunFieldBoundRefusal(build(BOUND + 1))).toEqual({
            status: 'refused',
            reason: 'collection-bound',
            collection: `run.${name}`,
            bound: BOUND,
        });
    });
});
