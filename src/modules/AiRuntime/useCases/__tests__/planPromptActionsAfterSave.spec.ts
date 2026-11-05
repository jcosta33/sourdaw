import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

import { AiProposalInvalidatedError } from '../../errors/AiProposalInvalidatedError';
import { type PlannedIntentResult } from '../../models/IntentResult';
import { estimateCompiledProviderRequestTokenCeiling } from '../../models/ModelProviderBudgetEstimate';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { type ProviderAttemptAdmission } from '../llmOrchestration/inference';
import { planPromptActions } from '../planPromptActions';

import { readyRequest } from './modelProviderProtocolFixture';
import { moveTrackFader, seedSavableProject, writeProjectSave } from './projectSaveFixture';

// The revision checks are the real ones over a real CRDT document and a real save write; only the
// planner, which would ask a provider, is replaced.
const mocks = vi.hoisted(() => ({
    parse: vi.fn<typeof import('../parsePromptToActions').parsePromptToActions>(),
}));
vi.mock('../parsePromptToActions', () => ({ parsePromptToActions: mocks.parse }));

type ProjectWrite = 'save' | 'edit';

/** What happens to the project while the planner is working. */
async function writeDuringPlanning(write: ProjectWrite): Promise<void> {
    if (write === 'edit') {
        moveTrackFader('track-1', 0.5);
    }
    await writeProjectSave();
}

function planReturning(write: ProjectWrite, result: PlannedIntentResult): void {
    mocks.parse.mockImplementationOnce(async () => {
        await writeDuringPlanning(write);
        return result;
    });
}

const PROPOSAL: PlannedIntentResult = {
    actions: [{ type: 'setTrackGain', payload: { trackId: 'track-1', gain: 0.7, expectedGain: 0.8 } }],
    rawText: 'turn track 1 down',
    requiresConfirmation: true,
    planningOutcome: { kind: 'proposal' },
};

const ANSWER: PlannedIntentResult = {
    actions: [],
    rawText: 'how loud is track 1',
    requiresConfirmation: false,
    planningOutcome: { kind: 'answer', text: 'Track 1 sits at unity.', evidence: [] },
};

/** The correction's own provider attempt, compiled as a provider would compile it. */
function correctionAttempt(): ProviderAttemptAdmission {
    const { request } = readyRequest({ provider: 'webllm', correlationId: 'correction-attempt-1' });
    const estimate = estimateCompiledProviderRequestTokenCeiling(request);
    return {
        backend: 'webllm',
        provider: 'webllm',
        correlationId: request.correlationId,
        request,
        estimatedTotalTokens: estimate.totalTokenCeiling,
        estimate,
    };
}

/** Asks the correction's own attempt admission, which planning hands the correction it runs. */
function admitCorrectionAttempt(input: Parameters<typeof mocks.parse>[0]): string | undefined {
    return input.onProviderAttempt?.(correctionAttempt()).status;
}

const CORRECTABLE_REASON = 'Provider action rejected: unknown target';

/** A provider rejection the planner classifies as a denial, as `parsePromptToActions` names it. */
const CORRECTABLE: PlannedIntentResult = {
    actions: [],
    rawText: 'turn track 1 down',
    requiresConfirmation: false,
    rejectionReason: CORRECTABLE_REASON,
    planningOutcome: { kind: 'denied', reason: CORRECTABLE_REASON },
};

beforeEach(() => {
    mocks.parse.mockReset();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('plan prompt actions after save test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    agentRunLifecycle.clear();
    projectStore.set(defaultProjectStoreState);
    trackStore.set({
        tracks: [createTrack({ id: 'track-1', name: 'Track 1', kind: 'audio' })],
        selectedTrackId: null,
        ghostClips: [],
    });
    seedSavableProject();
});

afterEach(() => {
    agentRunLifecycle.clear();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    projectStore.set(defaultProjectStoreState);
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('planning across a save', () => {
    it('offers the proposal planned while the project was saved, bound to the revision it planned against', async () => {
        planReturning('save', PROPOSAL);

        const result = await planPromptActions({ prompt: PROPOSAL.rawText });

        expect(result.result.actions).toEqual(PROPOSAL.actions);
        expect(mocks.parse.mock.calls[0]?.[0].projectRevision).toBe(result.projectRevision);
    });

    it('refuses the proposal once a fader moved while it was planned, saved or not', async () => {
        planReturning('edit', PROPOSAL);

        await expect(planPromptActions({ prompt: PROPOSAL.rawText })).rejects.toThrow(AiProposalInvalidatedError);
    });

    it('completes an answer composed while the project was saved', async () => {
        planReturning('save', ANSWER);

        const result = await planPromptActions({ prompt: ANSWER.rawText });

        expect(result.result.planningOutcome?.kind).toBe('answer');
    });

    it('refuses an answer once a fader moved while it was composed, saved or not', async () => {
        planReturning('edit', ANSWER);

        await expect(planPromptActions({ prompt: ANSWER.rawText })).rejects.toThrow(AiProposalInvalidatedError);
    });

    it('admits the bounded correction of a rejection the planner returned across a save', async () => {
        planReturning('save', CORRECTABLE);
        let correctionAdmission: string | undefined;
        mocks.parse.mockImplementationOnce(async (input) => {
            correctionAdmission = admitCorrectionAttempt(input);
            return PROPOSAL;
        });

        const result = await planPromptActions({
            prompt: PROPOSAL.rawText,
            onProviderAttempt: () => ({ status: 'admitted' }),
        });

        expect(mocks.parse).toHaveBeenCalledTimes(2);
        expect(correctionAdmission).toBe('admitted');
        expect(result.result.actions).toEqual(PROPOSAL.actions);
    });

    it('runs no correction once a fader moved before the rejection came back, saved or not', async () => {
        planReturning('edit', CORRECTABLE);

        const result = await planPromptActions({
            prompt: PROPOSAL.rawText,
            onProviderAttempt: () => ({ status: 'admitted' }),
        });

        expect(mocks.parse).toHaveBeenCalledTimes(1);
        expect(result.result.rejectionReason).toBe(CORRECTABLE.rejectionReason);
    });

    it('refuses the correction attempt itself once a fader moved after the correction began', async () => {
        planReturning('save', CORRECTABLE);
        let correctionAdmission: string | undefined;
        mocks.parse.mockImplementationOnce(async (input) => {
            moveTrackFader('track-1', 0.25);
            correctionAdmission = admitCorrectionAttempt(input);
            return CORRECTABLE;
        });

        await planPromptActions({ prompt: PROPOSAL.rawText, onProviderAttempt: () => ({ status: 'admitted' }) });

        expect(correctionAdmission).toBe('rejected');
    });
});
