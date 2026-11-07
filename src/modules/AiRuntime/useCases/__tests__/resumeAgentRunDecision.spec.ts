import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

const { resumeSend } = vi.hoisted(() => ({
    resumeSend: vi.fn().mockImplementation(async (_request, options) => {
        options.onResumedRunAdmitted('run-decision-resume-attempt');
        options.onResumedPlanAccepted();
    }),
}));

vi.mock('../sendChatMessage', () => ({ sendChatMessage: resumeSend }));

import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunControls } from '../getAgentRunControlProjection';
import { getPlanningProviderSchemaContract } from '../planningProviderSchema';

import { moveTrackFader, seedSavableProject, writeProjectSave } from './projectSaveFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();

const grants = {
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
};
const scope = { targetIds: ['bass-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] };

function createPendingDecision(input?: {
    budgets?: { limits: Record<string, number>; consumed: Record<string, number> };
    schemaIdentity?: string;
}): void {
    const revision = captureProjectRevision();
    const budgets = input?.budgets ?? { limits: {}, consumed: {} };
    agentRunLifecycle.create({
        runId: 'run-decision-resume',
        request: 'Mute Bass.',
        mode: 'plan',
        createdRevision: revision,
        scope,
        grants,
        budgets,
    });
    agentRunLifecycle.recordDecision({
        runId: 'run-decision-resume',
        decision: {
            decisionId: 'decision-mute',
            capabilitySchemaIdentity: input?.schemaIdentity ?? getPlanningProviderSchemaContract().identity,
            proposalIdentity: 'proposal-mute',
            budgets,
            revision,
            scope,
            grants,
            alternatives: [{ id: 'mute', label: 'Mute Bass', changesAuthority: false }],
            reason: 'Choose the bounded interpretation.',
            selectedAlternativeId: null,
            resumeAttemptId: null,
        },
    });
    agentRunLifecycle.requireManualResume({
        runId: 'run-decision-resume',
        reason: 'Choose the bounded interpretation.',
        workIds: [],
    });
}

describe('resumeAgentRunDecision', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('decision resume after save');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        trackStore.set({
            tracks: [createTrack({ id: 'bass-1', name: 'Bass', kind: 'audio' })],
            selectedTrackId: null,
            ghostClips: [],
        });
        seedSavableProject();
    });

    afterEach(() => {
        agentRunLifecycle.clear();
        resumeSend.mockClear();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        projectStore.set(structuredClone(defaultProjectStoreState));
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('resumes once with its original authority after a save-only checkpoint', async () => {
        createPendingDecision();
        const decision = structuredClone(agentRunLifecycle.get('run-decision-resume')!.decision!);
        await writeProjectSave();
        expect(captureProjectRevision()).not.toBe(decision.revision);
        expect(agentRunControls.get('run-decision-resume')?.allowedActions.resume).toBe(true);

        await expect(
            agentRunControls.resumeDecision({ runId: 'run-decision-resume', alternativeId: 'mute' })
        ).resolves.toMatchObject({ status: 'resumed' });
        expect(resumeSend).toHaveBeenCalledExactlyOnceWith(
            'Mute Bass.',
            expect.objectContaining({
                scope: decision.scope,
                grants: decision.grants,
                budgets: decision.budgets,
                resume: expect.objectContaining({
                    revision: decision.revision,
                    scope: decision.scope,
                    grants: decision.grants,
                    budgets: decision.budgets,
                    proposalIdentity: decision.proposalIdentity,
                    capabilitySchemaIdentity: decision.capabilitySchemaIdentity,
                }),
            })
        );
        expect(agentRunLifecycle.get('run-decision-resume')?.decision?.revision).toBe(decision.revision);
        await expect(
            agentRunControls.resumeDecision({ runId: 'run-decision-resume', alternativeId: 'mute' })
        ).resolves.toMatchObject({ status: 'rejected' });
        expect(resumeSend).toHaveBeenCalledTimes(1);
    });

    it.each(['saved', 'unflushed'] as const)(
        'rejects a %s fader edit before handing off the decision',
        async (kind) => {
            createPendingDecision();
            const decision = structuredClone(agentRunLifecycle.get('run-decision-resume')!.decision!);
            if (kind === 'saved') {
                moveTrackFader('bass-1', 0.5);
                await writeProjectSave();
            } else {
                const state = trackStore.value!;
                trackStore.set({ ...state, tracks: state.tracks.map((track) => ({ ...track, gain: 0.5 })) });
                expect(captureProjectRevision()).toBe(decision.revision);
            }
            expect(agentRunControls.get('run-decision-resume')?.allowedActions.resume).toBe(false);
            await expect(
                agentRunControls.resumeDecision({ runId: 'run-decision-resume', alternativeId: 'mute' })
            ).resolves.toMatchObject({ status: 'rejected' });
            expect(resumeSend).not.toHaveBeenCalled();
            expect(agentRunLifecycle.get('run-decision-resume')?.decision).toEqual(decision);
        }
    );

    it('rejects a decision after the project root is replaced', async () => {
        createPendingDecision();
        const decision = structuredClone(agentRunLifecycle.get('run-decision-resume')!.decision!);
        resetCrdtProjectAuthority('replacement project');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        seedSavableProject();
        expect(captureProjectRevision()).not.toBe(decision.revision);
        expect(agentRunControls.get('run-decision-resume')?.allowedActions.resume).toBe(false);
        await expect(
            agentRunControls.resumeDecision({ runId: 'run-decision-resume', alternativeId: 'mute' })
        ).resolves.toMatchObject({ status: 'rejected' });
        expect(resumeSend).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get('run-decision-resume')?.decision).toEqual(decision);
    });

    it('exposes and consumes one hydrated structured decision without parsing prose', async () => {
        createPendingDecision();
        expect(agentRunControls.get('run-decision-resume')?.allowedActions.resume).toBe(true);
        await expect(
            agentRunControls.resumeDecision({ runId: 'run-decision-resume', alternativeId: 'mute' })
        ).resolves.toEqual({
            status: 'resumed',
            sourceRunId: 'run-decision-resume',
            runId: 'run-decision-resume-attempt',
            decisionId: 'decision-mute',
            selectedAlternativeId: 'mute',
        });
        expect(resumeSend).toHaveBeenCalledWith(
            'Mute Bass.',
            expect.objectContaining({
                mode: 'plan',
                scope,
                grants,
                budgets: { limits: {}, consumed: {} },
                resume: expect.objectContaining({
                    sourceRunId: 'run-decision-resume',
                    decisionId: 'decision-mute',
                    selectedAlternativeId: 'mute',
                    selectedAlternative: { id: 'mute', label: 'Mute Bass', changesAuthority: false },
                }),
            })
        );
        await expect(
            agentRunControls.resumeDecision({ runId: 'run-decision-resume', alternativeId: 'mute' })
        ).resolves.toEqual(expect.objectContaining({ status: 'rejected' }));
    });

    it('rejects a cancelled pending decision', async () => {
        createPendingDecision();
        agentRunLifecycle.cancel({ runId: 'run-decision-resume', reason: 'Cancelled' });
        expect(agentRunControls.get('run-decision-resume')?.allowedActions.resume).toBe(false);
        await expect(
            agentRunControls.resumeDecision({ runId: 'run-decision-resume', alternativeId: 'mute' })
        ).resolves.toEqual(expect.objectContaining({ status: 'rejected' }));
    });

    it.each([
        {
            name: 'a budget exhausted after the decision was persisted',
            input: { budgets: { limits: { localAnalysis: 1 }, consumed: { localAnalysis: 1 } } },
        },
        {
            name: 'a capability schema identity mismatch',
            input: { schemaIdentity: 'retired-catalog-schema' },
        },
    ])('rejects $name before handoff or provider work', async ({ input }) => {
        createPendingDecision(input);

        await expect(
            agentRunControls.resumeDecision({ runId: 'run-decision-resume', alternativeId: 'mute' })
        ).resolves.toEqual(expect.objectContaining({ status: 'rejected' }));

        expect(resumeSend).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get('run-decision-resume')?.decision?.selectedAlternativeId).toBeNull();
    });

    it('admits only one concurrent replacement attempt for a pending decision', async () => {
        createPendingDecision();
        let release: () => void = () => {
            throw new Error('Expected the held handoff');
        };
        const entered = new Promise<void>((resolve) => {
            resumeSend.mockImplementation(async (_request, options) => {
                await new Promise<void>((done) => {
                    release = done;
                    resolve();
                });
                options.onResumedRunAdmitted('run-decision-resume-attempt');
                options.onResumedPlanAccepted();
            });
        });
        const first = agentRunControls.resumeDecision({ runId: 'run-decision-resume', alternativeId: 'mute' });
        await entered;
        await expect(
            agentRunControls.resumeDecision({ runId: 'run-decision-resume', alternativeId: 'mute' })
        ).resolves.toMatchObject({ status: 'rejected' });
        expect(resumeSend).toHaveBeenCalledTimes(1);
        expect(agentRunControls.get('run-decision-resume')?.allowedActions.resume).toBe(false);
        release();
        await expect(first).resolves.toMatchObject({ status: 'resumed' });
    });
});
