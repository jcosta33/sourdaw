import { afterEach, describe, expect, it } from 'vitest';

import { type AgentPlanProposal } from '../../models/AgentRun';
import { readAgentRunState, sanitizeAgentRunState } from '../../stores/agentRunStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { planAgentRun } from '../planAgentRun';

function providerProposal(overrides: Partial<AgentPlanProposal>): AgentPlanProposal {
    return {
        semantic: { classification: 'simple', uncertainty: [] },
        objective: 'Apply the selected action.',
        constraints: [],
        scope: { targetIds: ['bass-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
        capabilityIds: ['muteTrack'],
        assetIds: [],
        alternatives: [],
        validationStrategy: [],
        stoppingConditions: [],
        ...overrides,
    };
}

describe('planAgentRun', () => {
    afterEach(() => {
        agentRunLifecycle.clear();
    });
    it('materializes a revision-bound complex plan from grounded provider actions without claiming it heard audio', () => {
        const result = planAgentRun({
            request: 'Make the chorus lift and choose the route that fits the project.',
            revision: 'heads-1',
            actions: [{ type: 'setTrackGain' }, { type: 'setTrackPan' }],
            actionLabels: ['Raise the Chorus Vocal by 1.5 dB', 'Pan the doubled vocal'],
            scope: {
                targetIds: ['vocal-1', 'vocal-double'],
                targetRanges: [{ startBeat: 33, endBeat: 49 }],
                protectedTargetIds: ['master'],
                protectedRanges: [],
            },
            grants: {
                allowedOperationPrefixes: ['setTrack'],
                create: false,
                delete: false,
                routing: false,
                tempo: false,
                master: false,
                file: false,
                audioUpload: false,
                remoteGeneration: false,
                autoCommit: false,
            },
            budgets: { limits: { providerTokens: 4000 }, consumed: { providerTokens: 100 } },
            requiresConfirmation: true,
        });

        expect(result).toMatchObject({
            status: 'planned',
            plan: {
                classification: 'complex',
                revision: 'heads-1',
                objective: 'Make the chorus lift and choose the route that fits the project.',
                scope: { targetIds: ['vocal-1', 'vocal-double'], protectedTargetIds: ['master'] },
                steps: [
                    { order: 1, actionType: 'setTrackGain' },
                    { order: 2, actionType: 'setTrackPan' },
                ],
                expectedImpact: {
                    project: expect.any(Array),
                    audible: { status: 'not-claimed' },
                },
                capabilities: expect.arrayContaining([expect.objectContaining({ id: 'setTrackGain' })]),
                approvalPoints: [expect.objectContaining({ kind: 'command-confirmation' })],
                validationStrategy: expect.arrayContaining([expect.stringContaining('revision')]),
                stoppingConditions: expect.arrayContaining([expect.stringContaining('revision')]),
            },
        });
    });

    it('requires a user decision, and supplies no executable plan, when bounded provider alternatives change authority', () => {
        const result = planAgentRun({
            request: 'Process the vocals.',
            revision: 'heads-1',
            actions: [{ type: 'setTrackGain' }],
            actionLabels: ['Raise the vocal'],
            scope: { targetIds: ['vocal-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
            grants: {
                allowedOperationPrefixes: ['setTrack'],
                create: false,
                delete: false,
                routing: false,
                tempo: false,
                master: false,
                file: false,
                audioUpload: false,
                remoteGeneration: false,
                autoCommit: false,
            },
            budgets: { limits: {}, consumed: {} },
            requiresConfirmation: false,
            providerProposal: providerProposal({
                scope: { targetIds: ['vocal-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                capabilityIds: ['setTrackGain'],
                alternatives: [
                    { id: 'local-gain', label: 'Adjust the existing vocal gain', changesAuthority: false },
                    { id: 'upload-reference', label: 'Upload an audio reference', changesAuthority: true },
                ],
            }),
        });

        expect(result).toEqual({
            status: 'needs-user-decision',
            decision: expect.objectContaining({ alternatives: expect.any(Array) }),
        });
    });

    it('keeps an exact single-action request internally structured without requiring a plan panel', () => {
        const result = planAgentRun({
            request: 'Mute the selected track.',
            revision: 'heads-1',
            actions: [{ type: 'muteTrack' }],
            actionLabels: ['Mute Bass'],
            scope: { targetIds: ['bass-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
            grants: {
                allowedOperationPrefixes: ['muteTrack'],
                create: false,
                delete: false,
                routing: false,
                tempo: false,
                master: false,
                file: false,
                audioUpload: false,
                remoteGeneration: false,
                autoCommit: false,
            },
            budgets: { limits: {}, consumed: {} },
            requiresConfirmation: false,
        });

        expect(result).toMatchObject({
            status: 'planned',
            plan: { classification: 'simple', showPlanPanel: false, steps: [{ order: 1, actionType: 'muteTrack' }] },
        });
    });

    it('classifies structured uncertainty on a one-action request as complex without inspecting request prose', () => {
        const result = planAgentRun({
            request: 'Do it.',
            revision: 'heads-1',
            actions: [{ type: 'muteTrack' }],
            actionLabels: ['Mute Bass'],
            scope: { targetIds: ['bass-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
            grants: {
                allowedOperationPrefixes: ['muteTrack'],
                create: false,
                delete: false,
                routing: false,
                tempo: false,
                master: false,
                file: false,
                audioUpload: false,
                remoteGeneration: false,
                autoCommit: false,
            },
            budgets: { limits: {}, consumed: {} },
            requiresConfirmation: false,
            semanticEvidence: { uncertainty: ['ambiguous-target'] },
        });
        expect(result).toMatchObject({ status: 'planned', plan: { classification: 'complex', showPlanPanel: true } });
    });

    it('stops an executable plan before confirmation when validated authority or budget prerequisites are unavailable', () => {
        const base = {
            request: 'Mute Bass.',
            revision: 'heads-1',
            actions: [{ type: 'muteTrack' }],
            actionLabels: ['Mute Bass'],
            scope: { targetIds: ['bass-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
            grants: {
                allowedOperationPrefixes: ['setTrackGain'],
                create: false,
                delete: false,
                routing: false,
                tempo: false,
                master: false,
                file: false,
                audioUpload: false,
                remoteGeneration: false,
                autoCommit: false,
            },
            budgets: { limits: { providerTokens: 10 }, consumed: { providerTokens: 10 } },
            requiresConfirmation: false,
        };
        expect(planAgentRun(base)).toEqual(expect.objectContaining({ status: 'rejected' }));
    });

    it('rejects provider scope enlargement and capabilities that are absent from the application catalog', () => {
        const input = {
            request: 'Mute Bass.',
            revision: 'heads-1',
            actions: [{ type: 'muteTrack' }],
            actionLabels: ['Mute Bass'],
            scope: { targetIds: ['bass-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
            grants: {
                allowedOperationPrefixes: ['muteTrack'],
                create: false,
                delete: false,
                routing: false,
                tempo: false,
                master: false,
                file: false,
                audioUpload: false,
                remoteGeneration: false,
                autoCommit: false,
            },
            budgets: { limits: {}, consumed: {} },
            requiresConfirmation: false,
        };

        expect(
            planAgentRun({
                ...input,
                providerProposal: providerProposal({
                    scope: { ...input.scope, targetIds: ['bass-1', 'drum-bus'] },
                }),
            })
        ).toEqual(expect.objectContaining({ status: 'rejected', reason: expect.stringContaining('scope') }));
        expect(
            planAgentRun({
                ...input,
                providerProposal: providerProposal({ capabilityIds: ['generate-and-upload-audio'] }),
            })
        ).toEqual(expect.objectContaining({ status: 'rejected', reason: expect.stringContaining('capability') }));
    });

    it('persists and hydrates a canonical revision-bound plan rather than resume prose', () => {
        const planned = planAgentRun({
            request: 'Raise Bass by 1 dB.',
            revision: 'heads-7',
            actions: [{ type: 'setTrackGain' }],
            actionLabels: ['Raise Bass by 1 dB'],
            scope: { targetIds: ['bass-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
            grants: {
                allowedOperationPrefixes: ['setTrackGain'],
                create: false,
                delete: false,
                routing: false,
                tempo: false,
                master: false,
                file: false,
                audioUpload: false,
                remoteGeneration: false,
                autoCommit: false,
            },
            budgets: { limits: { providerTokens: 1000 }, consumed: { providerTokens: 12 } },
            requiresConfirmation: false,
        });
        expect(planned.status).toBe('planned');
        if (planned.status !== 'planned') {
            return;
        }
        agentRunLifecycle.create({
            runId: 'run-structured-plan',
            request: 'Raise Bass by 1 dB.',
            mode: 'apply',
            createdRevision: 'heads-7',
        });
        agentRunLifecycle.recordPlan({
            runId: 'run-structured-plan',
            summary: planned.plan.summary,
            commandIds: ['command-1'],
            serializedBatchIdentity: 'batch-1',
            revision: 'heads-7',
            scope: planned.plan.scope,
            grants: {
                allowedOperationPrefixes: ['setTrackGain'],
                create: false,
                delete: false,
                routing: false,
                tempo: false,
                master: false,
                file: false,
                audioUpload: false,
                remoteGeneration: false,
                autoCommit: false,
            },
            budgets: { limits: { providerTokens: 1000 }, consumed: { providerTokens: 12 } },
            plan: { ...planned.plan, commandIds: ['command-1'], serializedBatchIdentity: 'batch-1' },
        });

        expect(sanitizeAgentRunState(readAgentRunState())).toMatchObject({
            runs: [
                {
                    revisions: { planned: 'heads-7' },
                    plan: {
                        revision: 'heads-7',
                        objective: 'Raise Bass by 1 dB.',
                        steps: [{ order: 1, actionType: 'setTrackGain' }],
                        validationStrategy: expect.any(Array),
                        stoppingConditions: expect.any(Array),
                    },
                },
            ],
        });
    });

    it('rejects a plan when no exact operation grant admits its action, even without confirmation', () => {
        const result = planAgentRun({
            request: 'Mute Bass.',
            revision: 'heads-1',
            actions: [{ type: 'muteTrack' }],
            actionLabels: ['Mute Bass'],
            scope: { targetIds: ['bass-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
            grants: {
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
            },
            budgets: { limits: {}, consumed: {} },
            requiresConfirmation: false,
        });

        expect(result).toEqual(expect.objectContaining({ status: 'rejected' }));
    });

    it('persists an authority-bound unresolved decision before pausing a run', () => {
        agentRunLifecycle.create({
            runId: 'run-decision',
            request: 'Process vocals.',
            mode: 'apply',
            createdRevision: 'heads-9',
        });
        agentRunLifecycle.recordDecision({
            runId: 'run-decision',
            decision: {
                decisionId: 'decision-vocals',
                capabilitySchemaIdentity: 'catalog-v1',
                proposalIdentity: 'proposal-vocals',
                budgets: { limits: {}, consumed: {} },
                revision: 'heads-9',
                scope: { targetIds: ['vocal-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                grants: {
                    allowedOperationPrefixes: ['setTrackGain'],
                    create: false,
                    delete: false,
                    routing: false,
                    tempo: false,
                    master: false,
                    file: false,
                    audioUpload: false,
                    remoteGeneration: false,
                    autoCommit: false,
                },
                alternatives: [
                    { id: 'gain', label: 'Adjust the existing gain', changesAuthority: false },
                    { id: 'upload', label: 'Upload a reference', changesAuthority: true },
                ],
                reason: 'The alternatives change authority.',
                selectedAlternativeId: null,
                resumeAttemptId: null,
            },
        });
        agentRunLifecycle.requireManualResume({
            runId: 'run-decision',
            reason: 'The alternatives change authority.',
            workIds: [],
        });
        expect(sanitizeAgentRunState(readAgentRunState())).toMatchObject({
            runs: [
                {
                    phase: 'paused',
                    decision: { revision: 'heads-9', selectedAlternativeId: null, alternatives: expect.any(Array) },
                },
            ],
        });
    });
    describe('provider scope authority when the batch creates application-assigned entities', () => {
        const createdBusId = 'bus-ai-69ae2571-2c4c-4d1a-8f9b-0f2a9d4c7a11';
        const creationInput = {
            request: 'Send the backing vocals to a new plate bus.',
            revision: 'heads-3',
            actions: [{ type: 'createBus' }, { type: 'setTrackOutput' }],
            actionLabels: ['Create the backing vocal plate bus', 'Route the backing vocals to the plate bus'],
            scope: {
                targetIds: ['track-bgv-high', createdBusId, 'track-bgv-low'],
                targetRanges: [],
                protectedTargetIds: [],
                protectedRanges: [],
            },
            grants: {
                allowedOperationPrefixes: ['createBus', 'setTrackOutput'],
                create: true,
                delete: false,
                routing: true,
                tempo: false,
                master: false,
                file: false,
                audioUpload: false,
                remoteGeneration: false,
                autoCommit: false,
            },
            budgets: { limits: {}, consumed: {} },
            requiresConfirmation: false,
            applicationAssignedTargetIds: [createdBusId],
        };

        it('admits a proposal that names every pre-existing target the application computed', () => {
            const result = planAgentRun({
                ...creationInput,
                providerProposal: providerProposal({
                    scope: {
                        targetIds: ['track-bgv-high', 'track-bgv-low'],
                        targetRanges: [],
                        protectedTargetIds: [],
                        protectedRanges: [],
                    },
                    capabilityIds: ['createBus', 'setTrackOutput'],
                }),
            });

            expect(result).toEqual(expect.objectContaining({ status: 'planned' }));
        });

        it('admits a proposal that declares the same targets, protected targets, and ranges in another order', () => {
            const result = planAgentRun({
                ...creationInput,
                scope: {
                    targetIds: ['track-bgv-high', createdBusId, 'track-bgv-low'],
                    targetRanges: [
                        { startBeat: 33, endBeat: 49 },
                        { startBeat: 1, endBeat: 17 },
                    ],
                    protectedTargetIds: ['master', 'tape-bus'],
                    protectedRanges: [
                        { startBeat: 65, endBeat: 81 },
                        { startBeat: 9, endBeat: 25 },
                    ],
                },
                providerProposal: providerProposal({
                    scope: {
                        targetIds: ['track-bgv-low', 'track-bgv-high'],
                        targetRanges: [
                            { startBeat: 1, endBeat: 17 },
                            { startBeat: 33, endBeat: 49 },
                        ],
                        protectedTargetIds: ['tape-bus', 'master'],
                        protectedRanges: [
                            { startBeat: 9, endBeat: 25 },
                            { startBeat: 65, endBeat: 81 },
                        ],
                    },
                    capabilityIds: ['createBus', 'setTrackOutput'],
                }),
            });

            expect(result).toEqual(expect.objectContaining({ status: 'planned' }));
        });

        it('rejects a proposal that names a pre-existing target outside the computed scope', () => {
            const result = planAgentRun({
                ...creationInput,
                providerProposal: providerProposal({
                    scope: {
                        targetIds: ['track-bgv-high', 'track-bgv-low', 'drum-bus'],
                        targetRanges: [],
                        protectedTargetIds: [],
                        protectedRanges: [],
                    },
                    capabilityIds: ['createBus', 'setTrackOutput'],
                }),
            });

            expect(result).toEqual({
                status: 'rejected',
                reason: 'Provider attempted to enlarge or omit the application-owned scope.',
            });
        });

        it('rejects a proposal that omits a pre-existing target the application computed', () => {
            const result = planAgentRun({
                ...creationInput,
                providerProposal: providerProposal({
                    scope: {
                        targetIds: ['track-bgv-high'],
                        targetRanges: [],
                        protectedTargetIds: [],
                        protectedRanges: [],
                    },
                    capabilityIds: ['createBus', 'setTrackOutput'],
                }),
            });

            expect(result).toEqual({
                status: 'rejected',
                reason: 'Provider attempted to enlarge or omit the application-owned scope.',
            });
        });
    });
});
