import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    buildSemanticProjectDiff,
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import {
    type PendingActionSemanticDiff,
    clearPendingActionConfirmations,
    proposePendingActionConfirmation,
    updatePendingActionConfirmationStatus,
} from '../../stores/pendingActionConfirmationStore';
import { getAgentApprovalView } from '../getAgentApprovalView';

const REVISION = 'revision-approval-view';
const GAIN_COMMAND_ID = '33333333-3333-4333-8333-333333333331';
const REMOVE_COMMAND_ID = '33333333-3333-4333-8333-333333333332';

const mocks = vi.hoisted(() => ({
    captureRevision: vi.fn(),
    getRouteView: vi.fn(),
    validateApproval: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureRevision,
}));

vi.mock('../getProviderRouteView', () => ({
    getProviderRouteView: mocks.getRouteView,
}));

vi.mock('../validateAgentRiskApproval', () => ({
    validateAgentRiskApproval: mocks.validateApproval,
}));

const GAIN_ACTION = {
    type: 'setTrackGain',
    payload: { trackId: 'track-kick', gain: 0.8, expectedGain: 1 },
} satisfies AppAction;
const REMOVE_ACTION = { type: 'removeTrack', payload: { trackId: 'track-snare' } } satisfies AppAction;

const AGENT_APPROVAL = {
    schemaVersion: 1 as const,
    actionHashes: ['action-hash-gain', 'action-hash-remove'],
    sourceRevision: REVISION,
    targetFingerprints: { 'track-kick': 'fingerprint-kick' },
    advertisedTargetFingerprints: {},
    consequences: {
        audioUpload: false,
        fileAccess: false,
        maxImportedAssets: 0,
        maxRenderJobs: 0,
        remoteGeneration: false,
    },
    localActorId: 'actor-approval-view',
    policy: {
        decision: 'confirm' as const,
        reasons: ['Deletes an existing track.'],
        requiredTrustMode: 'destructive-commit' as const,
        risk: 'destructive-reversible' as const,
    },
};

const ROUTE_VIEW = {
    cost: [{ provider: 'hosted-anthropic', currency: 'USD', amount: 0.02 }],
    dataDisclosure: { categories: ['prompt-text'], retention: 'none' },
};

function buildCommandBatch() {
    const commands = [
        {
            action: GAIN_ACTION,
            commandId: GAIN_COMMAND_ID,
            effect: 'Set Kick gain to 0.8.',
            parameterUnits: [
                { argument: 'gain', unit: 'linear-gain' as const },
                { argument: 'expectedGain', unit: 'linear-gain' as const },
            ],
            reference: 'track-kick',
        },
        {
            action: REMOVE_ACTION,
            commandId: REMOVE_COMMAND_ID,
            effect: 'Remove the Snare track.',
            parameterUnits: [],
            reference: 'track-snare',
        },
    ].map((shape) =>
        serializeVersionedCommandEnvelope({
            ...createVersionedCommandEnvelope({
                action: shape.action,
                availableDeviceVersions: {},
                expectedEffect: shape.effect,
                normalizedProjectRevision: REVISION,
                objectReferences: [{ argument: 'trackId', id: shape.reference, scope: 'stable' }],
                parameterUnits: shape.parameterUnits,
                reason: shape.effect,
                time: [],
            }),
            commandId: shape.commandId,
        })
    );
    return compileVersionedCommandBatchEnvelope({
        runId: 'run-approval-view',
        batchId: 'batch-approval-view',
        projectId: 'project-approval-view',
        baseRevision: REVISION,
        intent: 'Rebalance the drums',
        commands,
        // Removing a track deletes whatever it holds, so the compiler refuses the batch without bounds.
        dynamicEffects: { affectedTrackIds: ['track-snare'], deletedObjects: 1 },
        protectedTargetIds: ['track-vocals'],
    });
}

const commandBatch = buildCommandBatch();

function buildDiff(): PendingActionSemanticDiff {
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    const diff = buildSemanticProjectDiff({
        envelope: parsed.envelope,
        recoveryByCommandId: { [GAIN_COMMAND_ID]: 'inverse', [REMOVE_COMMAND_ID]: 'compensable' },
    });
    return {
        ...diff,
        intentGroups: diff.intentGroups.map((group) => ({
            ...group,
            dependsOnGroupIds: group.id === REMOVE_COMMAND_ID ? [GAIN_COMMAND_ID] : [],
        })),
    };
}

type ProposeOverrides = {
    semanticDiff?: PendingActionSemanticDiff;
    supersedes?: string | null;
};

function propose(id: string, overrides: ProposeOverrides = {}) {
    const confirmation = proposePendingActionConfirmation({
        id,
        runId: 'run-approval-view',
        prompt: 'Rebalance the drums',
        assistantMessageId: 'assistant-approval-view',
        actions: [GAIN_ACTION, REMOVE_ACTION],
        actionLabels: ['Set Kick gain', 'Remove Snare'],
        commandBatch,
        agentApproval: AGENT_APPROVAL,
        semanticDiff: 'semanticDiff' in overrides ? overrides.semanticDiff : buildDiff(),
        affectedIds: ['track-kick', 'track-snare'],
        risk: { level: 'destructive-reversible', reason: 'Deletes an existing track.' },
        projectRevision: REVISION,
        supersedes: overrides.supersedes ?? null,
    });
    if (!confirmation) {
        throw new Error('The store refused the proposal.');
    }
    return confirmation;
}

function collectKeys(value: unknown, keys: Set<string>): Set<string> {
    if (Array.isArray(value)) {
        for (const entry of value) {
            collectKeys(entry, keys);
        }
        return keys;
    }
    if (value === null || typeof value !== 'object') {
        return keys;
    }
    for (const [key, nested] of Object.entries(value)) {
        keys.add(key);
        collectKeys(nested, keys);
    }
    return keys;
}

describe('getAgentApprovalView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearPendingActionConfirmations();
        mocks.captureRevision.mockReturnValue(REVISION);
        mocks.getRouteView.mockReturnValue(ROUTE_VIEW);
        mocks.validateApproval.mockReturnValue({ status: 'valid' });
    });

    afterEach(() => {
        clearPendingActionConfirmations();
    });

    // Red when an unknown confirmation id yields a view instead of nothing.
    it('returns nothing for a confirmation the store does not hold', () => {
        expect(getAgentApprovalView({ confirmationId: 'absent-confirmation' })).toBeNull();
    });

    // Red when a proposal matching the live revision is offered a re-preview anyway.
    it('reports a matching proposal as current and withholds re-preview', () => {
        propose('confirmation-current');

        const view = getAgentApprovalView({ confirmationId: 'confirmation-current' });

        expect(view?.freshness).toEqual({ status: 'current', currentRevision: REVISION });
        expect(view?.rePreview).toEqual({
            available: false,
            reason: 'The proposal still matches the current project.',
        });
        expect(mocks.validateApproval).toHaveBeenCalledWith(
            expect.objectContaining({ currentRevision: REVISION, approval: expect.objectContaining(AGENT_APPROVAL) })
        );
    });

    // Red when a stale validation is reported as mismatched, or stops offering a re-preview.
    it('reports a drifted proposal as stale and offers a re-preview', () => {
        mocks.captureRevision.mockReturnValue('revision-moved');
        mocks.validateApproval.mockReturnValue({
            status: 'invalid',
            reason: 'The approved source revision is stale.',
            stale: true,
        });
        propose('confirmation-stale');

        const view = getAgentApprovalView({ confirmationId: 'confirmation-stale' });

        expect(view?.freshness).toEqual({
            status: 'stale',
            reason: 'The approved source revision is stale.',
            currentRevision: 'revision-moved',
        });
        expect(view?.rePreview).toEqual({ available: true, reason: null });
    });

    // Red when a non-stale invalidity is folded into `stale` and loses the binding-mismatch reason.
    it('separates a binding mismatch from staleness', () => {
        mocks.validateApproval.mockReturnValue({
            status: 'invalid',
            reason: 'The local actor no longer matches the approval.',
            stale: false,
        });
        propose('confirmation-mismatched');

        const view = getAgentApprovalView({ confirmationId: 'confirmation-mismatched' });

        expect(view?.freshness).toEqual({
            status: 'mismatched',
            reason: 'The local actor no longer matches the approval.',
            currentRevision: REVISION,
        });
        expect(view?.rePreview).toEqual({ available: true, reason: null });
    });

    // Red when the view runs the validator over an invalidated proposal instead of reading its recorded reason.
    it('reports an invalidated proposal as stale under its recorded reason', () => {
        propose('confirmation-invalidated');
        updatePendingActionConfirmationStatus({
            confirmationId: 'confirmation-invalidated',
            status: 'invalidated',
            error: 'The approved target fingerprints no longer match.',
        });

        const view = getAgentApprovalView({ confirmationId: 'confirmation-invalidated' });

        expect(view?.freshness).toEqual({
            status: 'stale',
            reason: 'The approved target fingerprints no longer match.',
            currentRevision: REVISION,
        });
        expect(view?.rePreview).toEqual({ available: true, reason: null });
        expect(mocks.validateApproval).not.toHaveBeenCalled();
    });

    // Red when a settled proposal is re-validated and offered a re-preview it can no longer use.
    it('reports a settled proposal as settled and refuses a re-preview', () => {
        propose('confirmation-executed');
        updatePendingActionConfirmationStatus({ confirmationId: 'confirmation-executed', status: 'executed' });

        const view = getAgentApprovalView({ confirmationId: 'confirmation-executed' });

        expect(view?.freshness).toEqual({ status: 'settled', currentRevision: REVISION });
        expect(view?.rePreview).toEqual({ available: false, reason: 'The proposal is already executed.' });
    });

    // Red when a revision capture failure is reported as a current proposal.
    it('reports an unreadable project revision as a mismatch', () => {
        mocks.captureRevision.mockImplementation(() => {
            throw new Error('The project document is not open.');
        });
        propose('confirmation-unreadable');

        const view = getAgentApprovalView({ confirmationId: 'confirmation-unreadable' });

        expect(view?.freshness).toEqual({
            status: 'mismatched',
            reason: 'The project document is not open.',
            currentRevision: null,
        });
    });

    // Red when the view stops carrying the diff's groups, their prerequisites, or its destructive changes.
    it('projects intent groups, their prerequisites and the destructive changes', () => {
        propose('confirmation-diff');

        const view = getAgentApprovalView({ confirmationId: 'confirmation-diff' });

        expect(view?.intentGroups.map((group) => group.id)).toEqual([GAIN_COMMAND_ID, REMOVE_COMMAND_ID]);
        expect(view?.intentGroups.map((group) => group.dependsOnGroupIds)).toEqual([[], [GAIN_COMMAND_ID]]);
        expect(view?.destructiveChanges).toEqual([
            expect.objectContaining({
                classification: 'deletion',
                groupId: REMOVE_COMMAND_ID,
                objectIds: ['track-snare'],
                recovery: 'compensable',
            }),
        ]);
        expect(view?.warnings).toContain('1 destructive change requires explicit acceptance.');
        expect(view?.partialAcceptance).toEqual({
            available: false,
            reason: 'Aggregate dynamic effects cannot be partitioned across intent groups.',
        });
    });

    // Red when a proposal without a semantic preview claims an impact or a partial acceptance it never computed.
    it('says so when no semantic preview is available', () => {
        propose('confirmation-no-diff', { semanticDiff: undefined });

        const view = getAgentApprovalView({ confirmationId: 'confirmation-no-diff' });

        expect(view?.intentGroups).toEqual([]);
        expect(view?.destructiveChanges).toEqual([]);
        expect(view?.audioImpact).toEqual({
            level: 'none',
            summary: 'No semantic preview is available for this proposal.',
        });
        expect(view?.partialAcceptance).toEqual({
            available: false,
            reason: 'No semantic preview is available for this proposal.',
        });
    });

    // Red when the view binds expiry to a clock instead of the revision the proposal was approved against.
    it('binds expiry, scope, actor and budgets to the approved batch', () => {
        propose('confirmation-authority');

        const view = getAgentApprovalView({ confirmationId: 'confirmation-authority' });

        expect(view?.expiry).toEqual({ kind: 'revision-bound', revision: REVISION });
        expect(view?.baseRevision).toBe(REVISION);
        expect(view?.scope).toEqual(commandBatch.authority.scope);
        expect(view?.budgets).toEqual(commandBatch.authority.budgets);
        expect(view?.actor).toEqual({ localActorId: 'actor-approval-view' });
        expect(view?.consequences).toEqual(AGENT_APPROVAL.consequences);
        expect(view?.risk).toEqual({
            level: 'destructive-reversible',
            decision: 'confirm',
            reasons: ['Deletes an existing track.'],
            requiredTrustMode: 'destructive-commit',
        });
    });

    // Red when cost and data disclosure stop coming from the run's provider route.
    it('reports the run cost and data disclosure, and empties them when the run has no route', () => {
        propose('confirmation-route');

        expect(getAgentApprovalView({ confirmationId: 'confirmation-route' })).toMatchObject({
            cost: ROUTE_VIEW.cost,
            dataDisclosure: ROUTE_VIEW.dataDisclosure,
        });
        expect(mocks.getRouteView).toHaveBeenCalledWith({ runId: 'run-approval-view' });

        mocks.getRouteView.mockReturnValue(null);

        expect(getAgentApprovalView({ confirmationId: 'confirmation-route' })).toMatchObject({
            cost: [],
            dataDisclosure: null,
        });
    });

    // Red when the view leaks the serialized batch the caller could execute the proposal from.
    it('carries no serialized command batch anywhere in the view', () => {
        propose('confirmation-presentation-safe', { supersedes: 'confirmation-earlier' });

        const view = getAgentApprovalView({ confirmationId: 'confirmation-presentation-safe' });

        expect(view?.supersedes).toBe('confirmation-earlier');
        expect(view?.supersededBy).toBeNull();
        expect([...collectKeys(view, new Set<string>())]).not.toContain('serialized');
    });
});
