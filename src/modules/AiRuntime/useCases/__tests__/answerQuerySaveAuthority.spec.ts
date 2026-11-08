import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    projectRevisionMatchesLiveIgnoringSaveWrites,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

import { createAnswerInterpretationToolSchema } from '../../models/AnswerInterpretation';
import { type ToolCallResult } from '../../models/ToolCallResult';
import { admitAnswerInterpretation } from '../admitAnswerInterpretation';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { getProjectContext } from '../getProjectContext';
import { prepareAnswerInterpretationCatalog } from '../prepareAnswerInterpretationCatalog';

import { moveTrackFader, seedSavableProject, writeProjectSave } from './projectSaveFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();

const PROMPT = 'Summarize the project structure.';
type Change = 'none' | 'save' | 'two-saves' | 'pending-edit' | 'edit' | 'saved-edit' | 'reverted-edit';

async function queryAcross(change: Change) {
    const originalRevision = captureProjectRevision();
    const catalog = prepareAnswerInterpretationCatalog({
        prompt: PROMPT,
        context: getProjectContext(),
        projectRevision: originalRevision,
    });
    const intake: ToolCallResult = {
        id: 'intake',
        name: createAnswerInterpretationToolSchema(catalog).function.name,
        arguments: {
            catalogId: catalog.catalogId,
            kind: 'project-facts',
            topicIds: [],
            scopeCandidateIds: [],
            rangeCandidateId: null,
            uncertainty: 'none',
        },
    };
    let queryRevision = '';
    const result = await runApplicationOwnedToolLoop({
        loopId: 'answer-query-save',
        terminalToolNames: new Set(['answer.respond']),
        answerInterpretation: {
            admit: (call) => admitAnswerInterpretation({ catalog, call, projectRevision: originalRevision }),
        },
        requestTurn: async ({ turn }) => {
            if (turn === 1) {
                return { status: 'complete', toolCalls: [intake] };
            }
            if (turn === 2) {
                if (change === 'save' || change === 'two-saves') {
                    await writeProjectSave();
                }
                if (change === 'pending-edit') {
                    const state = trackStore.value!;
                    trackStore.set({ ...state, tracks: state.tracks.map((track) => ({ ...track, gain: 0.5 })) });
                }
                if (change === 'edit' || change === 'saved-edit' || change === 'reverted-edit') {
                    moveTrackFader('track-1', 0.5);
                }
                if (change === 'saved-edit') {
                    await writeProjectSave();
                }
                if (change === 'reverted-edit') {
                    moveTrackFader('track-1', 0.8);
                }
                queryRevision = captureProjectRevision();
                return {
                    status: 'complete',
                    toolCalls: [{ id: 'query', name: 'project.query', arguments: { type: 'project-summary' } }],
                };
            }
            if (change === 'two-saves') {
                await writeProjectSave();
            }
            return {
                status: 'complete',
                toolCalls: [
                    {
                        id: 'answer',
                        name: 'answer.respond',
                        arguments: { intakeCallId: 'intake', statements: [{ kind: 'query-page', callId: 'query' }] },
                    },
                ],
            };
        },
    });
    return { result, originalRevision, queryRevision };
}

beforeEach(() => {
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('answer query save authority');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    trackStore.set({
        tracks: [createTrack({ id: 'track-1', name: 'Track', kind: 'audio' })],
        selectedTrackId: null,
        ghostClips: [],
    });
    seedSavableProject();
    projectStore.set({ ...projectStore.value!, initialized: true, loading: false });
    flushAutomergeStorageWrites();
});

afterEach(() => {
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    projectStore.set(defaultProjectStoreState);
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('query evidence across project saves', () => {
    it.each(['none', 'save', 'two-saves'] as const)(
        'answers after %s with the actual query receipt',
        async (change) => {
            const { result, originalRevision, queryRevision } = await queryAcross(change);
            const query = result.receipts.find((receipt) => receipt.callId === 'query');
            expect(query).toMatchObject({ status: 'success', data: { revision: JSON.parse(queryRevision) } });
            expect(query?.revision).toMatch(/^spq1\./);
            expect(result.receipts.find((receipt) => receipt.callId === 'intake')).toMatchObject({
                status: 'success',
                revision: originalRevision,
            });
            expect(projectRevisionMatchesLiveIgnoringSaveWrites(originalRevision)).toBe(true);
            if (change !== 'none') {
                expect(queryRevision).not.toBe(originalRevision);
            }
            expect(result.status).toBe('complete');
            if (result.status !== 'complete') {
                throw new Error(result.reason);
            }
            expect(result.answer?.evidence.map((entry) => entry.callId)).toEqual(['intake', 'query']);
            expect(result.proposal).toBeNull();
        }
    );
    it.each(['pending-edit', 'edit', 'saved-edit', 'reverted-edit'] as const)(
        'refuses query evidence after %s',
        async (change) => {
            const { result } = await queryAcross(change);
            expect(result).toMatchObject({
                status: 'rejected',
                reason: 'Answer references evidence outside its frozen interpretation or successful bounded reads.',
            });
        }
    );
});
