import { describe, expect, it } from 'vitest';

import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentWorkBudget } from '../agentWorkBudget';

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

        const reserved = agentWorkBudget.reserveCommandWork({
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
        expect(
            agentWorkBudget.reserveCommandWork({ runId: 'limited-work-run', attemptId: 'batch-a:1', envelope })
        ).toMatchObject({
            status: 'reserved',
        });
        expect(
            agentWorkBudget.reserveCommandWork({ runId: 'limited-work-run', attemptId: 'batch-b:1', envelope })
        ).toMatchObject({
            status: 'hard-limit-reached',
            reason: 'maxRenderJobs',
        });
    });

    it('reserves stem analysis, download, and storage together under the existing attempt identities', () => {
        agentRunLifecycle.clear();
        agentRunLifecycle.create({
            runId: 'stem-work-run',
            request: 'Import selected stems.',
            mode: 'macro',
            createdRevision: 'revision-a',
            budgets: {
                limits: { localAnalysis: 2, downloadBytes: 4, storageBytes: 8 },
                consumed: {},
            },
        });
        const admit = agentWorkBudget.admitStemPreparation('stem-work-run');

        expect(admit({ analysisCount: 2, downloadBytes: 4, storageBytes: 8 })).toBe(true);
        expect(admit({ analysisCount: 2, downloadBytes: 4, storageBytes: 8 })).toBe(true);
        expect(agentRunLifecycle.get('stem-work-run')?.budgetAttempts).toMatchObject([
            {
                attemptId: 'stem-preparation:localAnalysis',
                category: 'localAnalysis',
                reserved: 2,
                provenance: 'versioned-estimate',
            },
            {
                attemptId: 'stem-preparation:downloadBytes',
                category: 'downloadBytes',
                reserved: 4,
                provenance: 'versioned-estimate',
            },
            {
                attemptId: 'stem-preparation:storageBytes',
                category: 'storageBytes',
                reserved: 8,
                provenance: 'versioned-estimate',
            },
        ]);
        expect(agentRunLifecycle.get('stem-work-run')?.budgets.consumed).toEqual({
            localAnalysis: 2,
            downloadBytes: 4,
            storageBytes: 8,
        });
    });

    it('leaves all stem categories unreserved when one hard limit refuses the batch', () => {
        agentRunLifecycle.clear();
        agentRunLifecycle.create({
            runId: 'stem-limited-run',
            request: 'Import selected stems.',
            mode: 'macro',
            createdRevision: 'revision-a',
            budgets: {
                limits: { localAnalysis: 2, downloadBytes: 4, storageBytes: 1 },
                consumed: {},
            },
        });

        expect(
            agentWorkBudget.admitStemPreparation('stem-limited-run')({
                analysisCount: 2,
                downloadBytes: 4,
                storageBytes: 8,
            })
        ).toBe(false);
        expect(agentRunLifecycle.get('stem-limited-run')?.budgetAttempts).toEqual([]);
        expect(agentRunLifecycle.get('stem-limited-run')?.budgets.consumed).toEqual({});
    });
});
