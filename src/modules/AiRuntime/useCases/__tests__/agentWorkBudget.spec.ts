import { describe, expect, it } from 'vitest';

import { agentRunLifecycle } from '../agentRunLifecycle';
import { reserveAgentCommandWork } from '../agentWorkBudget';

describe('agent work budget', () => {
    it('reserves command, render, import, storage, and dynamic effect work before execution', () => {
        agentRunLifecycle.clear();
        agentRunLifecycle.create({
            runId: 'local-work-run',
            request: 'Render and import.',
            mode: 'macro',
            createdRevision: 'revision-a',
            budgets: {
                limits: {
                    maxCommands: 2,
                    maxRenderJobs: 1,
                    maxImportedAssets: 1,
                    maxAffectedTracks: 2,
                },
                consumed: {},
            },
        });

        const reserved = reserveAgentCommandWork({
            runId: 'local-work-run',
            attemptId: 'batch-a:1',
            envelope: {
                commands: [
                    { operation: 'renderProjectSections', objectReferences: [], arguments: { sectionIds: ['chorus'] } },
                    { operation: 'importStemSet', objectReferences: [], arguments: { stems: [{ trackId: 'bass' }] } },
                ] as never,
                dynamicEffects: { affectedTrackIds: ['bass'] },
            },
        });

        expect(reserved).toMatchObject({ status: 'reserved' });
        expect(agentRunLifecycle.get('local-work-run')?.budgets.consumed).toEqual({
            maxCommands: 2,
            maxRenderJobs: 1,
            maxImportedAssets: 1,
            maxAffectedTracks: 1,
        });
    });

    it('does not start a repeated approved batch when its next local effect would exceed the hard ceiling', () => {
        agentRunLifecycle.clear();
        agentRunLifecycle.create({
            runId: 'limited-work-run',
            request: 'Render.',
            mode: 'macro',
            createdRevision: 'revision-a',
            budgets: { limits: { maxRenderJobs: 1 }, consumed: {} },
        });
        const envelope = {
            commands: [
                { operation: 'renderProjectSections', objectReferences: [], arguments: { sectionIds: ['chorus'] } },
            ] as never,
        };
        expect(reserveAgentCommandWork({ runId: 'limited-work-run', attemptId: 'batch-a:1', envelope })).toMatchObject({
            status: 'reserved',
        });
        expect(reserveAgentCommandWork({ runId: 'limited-work-run', attemptId: 'batch-b:1', envelope })).toMatchObject({
            status: 'hard-limit-reached',
            reason: 'maxRenderJobs',
        });
    });
});
