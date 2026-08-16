import { afterEach, describe, expect, it } from 'vitest';

import { readAgentRunState, sanitizeAgentRunState } from '../../stores/agentRunStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { planAgentRun } from '../planAgentRun';

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
            providerProposal: {
                alternatives: [
                    { id: 'local-gain', label: 'Adjust the existing vocal gain', changesAuthority: false },
                    { id: 'upload-reference', label: 'Upload an audio reference', changesAuthority: true },
                ],
            },
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
                providerProposal: {
                    scope: { ...input.scope, targetIds: ['bass-1', 'drum-bus'] },
                },
            })
        ).toEqual(expect.objectContaining({ status: 'rejected', reason: expect.stringContaining('scope') }));
        expect(
            planAgentRun({
                ...input,
                providerProposal: { capabilityIds: ['generate-and-upload-audio'] },
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
});
