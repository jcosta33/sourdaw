import { type AgentContextEvidence } from '../models/AgentContext';
import {
    type AgentRun,
    type AgentRunBudgets,
    type AgentRunDecision,
    type AgentRunDecisionResume,
    type AgentRunGrants,
    type AgentRunScope,
} from '../models/AgentRun';

import {
    type AgentRunFieldName,
    type AgentRunPlanBoundRefusal,
    type BoundedCollection,
    boundedCollection,
    readCollectionBoundRefusal,
} from './readAgentRunPlanBoundRefusal';

/** The run collections the persistent schema reads back at the shared collection bound; only their length is read. */
const RUN_COLLECTION_KEYS = [
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

type AgentRunCollectionKey = (typeof RUN_COLLECTION_KEYS)[number];

export type AgentRunBoundSubject = Pick<
    AgentRun,
    'scope' | 'grants' | 'budgets' | 'budgetAttempts' | 'manualResume' | 'contextEvidence'
> & {
    decision: Pick<AgentRunDecision, 'scope' | 'grants' | 'budgets' | 'alternatives'> | null;
    resume: Pick<AgentRunDecisionResume, 'scope' | 'grants' | 'budgets'> | null;
    saga: { steps: readonly unknown[] };
} & Record<AgentRunCollectionKey, readonly unknown[] | undefined>;

function field(path: string): AgentRunFieldName {
    return `run.${path}`;
}

function scopeCollections(path: string, scope: AgentRunScope): BoundedCollection[] {
    return [
        boundedCollection(field(`${path}.targetIds`), scope.targetIds),
        boundedCollection(field(`${path}.targetRanges`), scope.targetRanges),
        boundedCollection(field(`${path}.protectedTargetIds`), scope.protectedTargetIds),
        boundedCollection(field(`${path}.protectedRanges`), scope.protectedRanges),
    ];
}

function authorityCollections(
    prefix: string,
    grants: Pick<AgentRunGrants, 'allowedOperationPrefixes'>,
    budgets: AgentRunBudgets
): BoundedCollection[] {
    return [
        boundedCollection(field(`${prefix}grants.allowedOperationPrefixes`), grants.allowedOperationPrefixes),
        boundedCollection(field(`${prefix}budgets.limits`), Object.keys(budgets.limits)),
        boundedCollection(field(`${prefix}budgets.consumed`), Object.keys(budgets.consumed)),
    ];
}

function contextEvidenceCollections(evidence: AgentContextEvidence | null): BoundedCollection[] {
    if (evidence === null) {
        return [];
    }
    const { snapshot, grants, budgets } = evidence;
    return [
        boundedCollection(field('contextEvidence.selection.clipIds'), evidence.selection.clipIds),
        boundedCollection(field('contextEvidence.snapshot.selectableTargets'), snapshot.selectableTargets),
        boundedCollection(field('contextEvidence.snapshot.automationLanes'), snapshot.automationLanes),
        boundedCollection(field('contextEvidence.snapshot.sections'), snapshot.sections ?? []),
        boundedCollection(
            field('contextEvidence.grants.allowedOperationPrefixes'),
            grants?.allowedOperationPrefixes ?? []
        ),
        boundedCollection(field('contextEvidence.budgets.limits'), Object.keys(budgets?.limits ?? {})),
        boundedCollection(field('contextEvidence.budgets.consumed'), Object.keys(budgets?.consumed ?? {})),
    ];
}

function decisionCollections(decision: AgentRunBoundSubject['decision']): BoundedCollection[] {
    if (decision === null) {
        return [];
    }
    return [
        ...scopeCollections('decision.scope', decision.scope),
        ...authorityCollections('decision.', decision.grants, decision.budgets),
        boundedCollection(field('decision.alternatives'), decision.alternatives),
    ];
}

function resumeCollections(resume: AgentRunBoundSubject['resume']): BoundedCollection[] {
    if (resume === null) {
        return [];
    }
    return [
        ...scopeCollections('resume.scope', resume.scope),
        ...authorityCollections('resume.', resume.grants, resume.budgets),
    ];
}

function listRunCollections(run: AgentRunBoundSubject): BoundedCollection[] {
    return [
        ...scopeCollections('scope', run.scope),
        ...authorityCollections('', run.grants, run.budgets),
        boundedCollection(field('budgetAttempts'), run.budgetAttempts),
        boundedCollection(field('manualResume.workIds'), run.manualResume.workIds),
        boundedCollection(field('saga.steps'), run.saga.steps),
        ...RUN_COLLECTION_KEYS.map((key) => boundedCollection(field(key), run[key] ?? [])),
        ...decisionCollections(run.decision),
        ...resumeCollections(run.resume),
        ...contextEvidenceCollections(run.contextEvidence),
    ];
}

/** Checks a run's own fields against the bounds `sanitizeAgentRunState` reads them back under; `null` admits it. */
export function readAgentRunFieldBoundRefusal(run: AgentRunBoundSubject): AgentRunPlanBoundRefusal | null {
    return readCollectionBoundRefusal(listRunCollections(run));
}
