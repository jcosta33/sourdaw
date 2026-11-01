import { beforeEach, describe, expect, it } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { getCreativeSelectionSnapshot } from '../../models/CreativeInterpretation';
import { type AnswerRequestAuthority, type AnswerStatement } from '../answerContractTypes';
import { type AdmittedAnswerIntake, type AdmittedAnswerRead, composeMeasuredAnswer } from '../composeMeasuredAnswer';
import { discoverMixRecipes } from '../discoverMixRecipes';
import { getProjectContext } from '../getProjectContext';

const VOCAL_ID = 'track-lead-vocal';
const BUS_ID = 'track-vocal-bus';
const OFFER =
    'Choose Propose this to prepare it for “Lead Vocal” as a proposal, using the middle of each authored window; nothing changes until you approve it.';

function receipt(callId: string, toolName: string): ApplicationToolReceipt {
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId,
        toolName,
        turn: callId === 'intake' ? 1 : 2,
        status: 'success',
        revision: 'revision',
        data: null,
        summary: `${toolName} read`,
        warnings: [],
        error: null,
    };
}

function catalogIntake(): AdmittedAnswerIntake {
    const context = getProjectContext();
    const authority: AnswerRequestAuthority = {
        schemaVersion: 1,
        catalogId: 'catalog',
        requestDigest: 'digest',
        revision: 'revision',
        selection: getCreativeSelectionSnapshot(context),
        kind: 'catalog-knowledge',
        topics: [],
        scopes: [],
        scopeCandidateIds: [],
        range: null,
        requiredMetrics: [],
        context,
    };
    return { callId: 'intake', turn: 1, authority };
}

/** A real discovery receipt for the warm recipes, read against the same tracks the intake froze. */
function discoveryRead(callId: string, targetId: string | null, role: string | null = null): AdmittedAnswerRead {
    const discovered = discoverMixRecipes(
        { descriptors: ['warm'], targetId, role, limit: 4 },
        getProjectContext().tracks
    );
    if (discovered.status !== 'ok') {
        throw new Error('Discovery fixture must resolve.');
    }
    return { receipt: receipt(callId, 'recipe.discover'), source: { kind: 'recipe', value: discovered.data } };
}

function compose(statements: AnswerStatement[], reads: AdmittedAnswerRead[]) {
    const intake = catalogIntake();
    return composeMeasuredAnswer({
        document: { intakeCallId: 'intake', statements },
        intake,
        reads: new Map(reads.map((read) => [read.receipt.callId, read])),
        receipts: [receipt('intake', 'selectAnswerInterpretation'), ...reads.map((read) => read.receipt)],
    });
}

function accepted(result: ReturnType<typeof compose>) {
    if (result.status !== 'accepted') {
        throw new Error(result.reason);
    }
    return result.answer;
}

beforeEach(() => {
    projectStore.set({
        ...structuredClone(defaultProjectStoreState),
        projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
        initialized: true,
        loading: false,
    });
    trackStore.set({
        tracks: [
            createTrack({ id: VOCAL_ID, name: 'Lead Vocal', kind: 'audio' }),
            createTrack({ id: BUS_ID, name: 'Vocal Bus', kind: 'bus' }),
        ],
        selectedTrackId: null,
        ghostClips: [],
    });
});

describe('an answer that describes one recipe for one track offers to propose it', () => {
    it('mints the suggestion from the discovery receipt and states the offer after the recipe', () => {
        const answer = accepted(
            compose([{ kind: 'recipe', callId: 'recipe', recipeId: 'vocal-warm' }], [discoveryRead('recipe', VOCAL_ID)])
        );

        expect(answer.suggestion).toEqual({
            recipeId: 'vocal-warm',
            recipeTitle: 'Chest-register lift with a softened upper shelf',
            targetId: VOCAL_ID,
            targetName: 'Lead Vocal',
            recipeRole: 'vocal',
            roleSource: 'target',
        });
        expect(answer.text.startsWith('The catalog recipe “Chest-register lift with a softened upper shelf”')).toBe(
            true
        );
        expect(answer.text.endsWith(` ${OFFER}`)).toBe(true);
    });

    it('records an explicit discovery role as the role the proposal resolves', () => {
        const answer = accepted(
            compose(
                [{ kind: 'recipe', callId: 'recipe', recipeId: 'vocal-warm' }],
                [discoveryRead('recipe', VOCAL_ID, 'vocal')]
            )
        );

        expect(answer.suggestion).toMatchObject({ recipeRole: 'vocal', roleSource: 'argument' });
    });

    it('puts the offer beside its recipe, not at the end of the answer', () => {
        const answer = accepted(
            compose(
                [
                    { kind: 'recipe', callId: 'recipe', recipeId: 'vocal-warm' },
                    { kind: 'limitation', code: 'perception-not-inferred' },
                ],
                [discoveryRead('recipe', VOCAL_ID)]
            )
        );

        const [recipeParagraph, limitation] = answer.text.split('\n\n');
        expect(recipeParagraph?.endsWith(OFFER)).toBe(true);
        expect(limitation).toBe('These objective measurements do not establish perceived sound quality or its cause.');
    });

    it('offers nothing for two recipe statements, which would not say which change it prepares', () => {
        const answer = accepted(
            compose(
                [
                    { kind: 'recipe', callId: 'recipe', recipeId: 'vocal-warm' },
                    { kind: 'recipe', callId: 'recipe', recipeId: 'vocal-warm' },
                ],
                [discoveryRead('recipe', VOCAL_ID)]
            )
        );

        expect(answer.suggestion).toBeUndefined();
        expect(answer.text).not.toContain('Propose this');
    });

    it('offers nothing when discovery named no target track', () => {
        const answer = accepted(
            compose(
                [{ kind: 'recipe', callId: 'recipe', recipeId: 'vocal-warm' }],
                [discoveryRead('recipe', null, 'vocal')]
            )
        );

        expect(answer.suggestion).toBeUndefined();
        expect(answer.text).not.toContain('Propose this');
    });

    it('offers nothing for a bus, whose chain is not one track of its own', () => {
        const answer = accepted(
            compose(
                [{ kind: 'recipe', callId: 'recipe', recipeId: 'vocal-warm' }],
                [discoveryRead('recipe', BUS_ID, 'vocal')]
            )
        );

        expect(answer.suggestion).toBeUndefined();
        expect(answer.text).not.toContain('Propose this');
    });

    it('offers nothing when the frozen read no longer holds the discovered track', () => {
        const read = discoveryRead('recipe', VOCAL_ID);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });

        const answer = accepted(compose([{ kind: 'recipe', callId: 'recipe', recipeId: 'vocal-warm' }], [read]));

        expect(answer.suggestion).toBeUndefined();
        expect(answer.text).not.toContain('Propose this');
    });
});
