import { beforeEach, describe, expect, it } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

import { ANSWER_RESPOND_MAX_COMPOSED_CHARACTERS } from '../../models/AnswerRespond';
import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { getCreativeSelectionSnapshot } from '../../models/CreativeInterpretation';
import { type AnswerRequestAuthority, type AnswerStatement } from '../answerContractTypes';
import { type AdmittedAnswerIntake, type AdmittedAnswerRead, composeMeasuredAnswer } from '../composeMeasuredAnswer';
import { discoverMixRecipes } from '../discoverMixRecipes';
import { getProjectContext } from '../getProjectContext';

const VOCAL_ID = 'track-lead-vocal';
const BUS_ID = 'track-vocal-bus';
const BASS_ID = 'track-bass';
const UNTITLED_ID = 'track-untitled';
const MIDI_ID = 'track-midi';
const RECIPE: AnswerStatement = { kind: 'recipe', callId: 'recipe', recipeId: 'vocal-warm' };
const PERCEPTION: AnswerStatement = { kind: 'limitation', code: 'perception-not-inferred' };
const PERCEPTION_TEXT = 'These objective measurements do not establish perceived sound quality or its cause.';
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

function intakeOf(overrides: Partial<AnswerRequestAuthority> = {}): AdmittedAnswerIntake {
    const context = getProjectContext();
    const authority: AnswerRequestAuthority = {
        schemaVersion: 1,
        catalogId: 'catalog',
        requestDigest: 'digest',
        revision: 'revision',
        selection: getCreativeSelectionSnapshot(context),
        kind: 'catalog-knowledge',
        topics: [],
        scopes: [trackScope(VOCAL_ID, 'Lead Vocal')],
        scopeCandidateIds: [],
        range: null,
        requiredMetrics: [],
        context,
        ...overrides,
    };
    return { callId: 'intake', turn: 1, authority };
}

function trackScope(id: string, label: string): AnswerRequestAuthority['scopes'][number] {
    return { candidateId: `scope-${id}`, kind: 'tracks', objectIds: [id], labels: [label] };
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

function compose(statements: AnswerStatement[], reads: AdmittedAnswerRead[], intake = intakeOf()) {
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
            createTrack({ id: BASS_ID, name: 'Bass', kind: 'audio' }),
            createTrack({ id: UNTITLED_ID, name: 'Audio 1', kind: 'audio' }),
            createTrack({ id: MIDI_ID, name: 'MIDI 1', kind: 'midi' }),
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

    it('offers nothing for a bus the question named, whose chain is not one track of its own', () => {
        const answer = accepted(
            compose(
                [{ kind: 'recipe', callId: 'recipe', recipeId: 'bus-warm' }],
                [discoveryRead('recipe', BUS_ID)],
                intakeOf({
                    scopes: [{ candidateId: 'scope-bus', kind: 'buses', objectIds: [BUS_ID], labels: ['Vocal Bus'] }],
                })
            )
        );

        expect(answer.suggestion).toBeUndefined();
        expect(answer.text).not.toContain('Propose this');
    });

    it('offers the change for a MIDI track the question named', () => {
        const answer = accepted(
            compose(
                [{ kind: 'recipe', callId: 'recipe', recipeId: 'vocal-warm' }],
                [discoveryRead('recipe', MIDI_ID, 'vocal')],
                intakeOf({ scopes: [trackScope(MIDI_ID, 'MIDI 1')] })
            )
        );

        expect(answer.suggestion).toMatchObject({ targetId: MIDI_ID, targetName: 'MIDI 1' });
    });

    it('offers nothing when the frozen read no longer holds the discovered track', () => {
        const read = discoveryRead('recipe', VOCAL_ID);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });

        const answer = accepted(compose([{ kind: 'recipe', callId: 'recipe', recipeId: 'vocal-warm' }], [read]));

        expect(answer.suggestion).toBeUndefined();
        expect(answer.text).not.toContain('Propose this');
    });
});

describe('an offer is made only about what the question asked, and never at the answer’s cost', () => {
    it('offers nothing for a discovered track outside the tracks the question named', () => {
        const answer = accepted(
            compose([RECIPE], [discoveryRead('recipe', VOCAL_ID)], intakeOf({ scopes: [trackScope(BASS_ID, 'Bass')] }))
        );

        expect(answer.suggestion).toBeUndefined();
        expect(answer.text).not.toContain('Propose this');
    });

    it('offers nothing when the interpretation names no subject, leaving the target to discovery alone', () => {
        const answer = accepted(compose([RECIPE], [discoveryRead('recipe', VOCAL_ID)], intakeOf({ scopes: [] })));

        expect(answer.suggestion).toBeUndefined();
        expect(answer.text).not.toContain('Propose this');
    });

    it('offers nothing when the discovery role argument differs from the role the track itself gives', () => {
        const answer = accepted(
            compose(
                [RECIPE],
                [discoveryRead('recipe', BASS_ID, 'vocal')],
                intakeOf({ scopes: [trackScope(BASS_ID, 'Bass')] })
            )
        );

        expect(answer.suggestion).toBeUndefined();
        expect(answer.text).not.toContain('Propose this');
    });

    it('offers an argued role for a track whose own canonical role gives none', () => {
        const answer = accepted(
            compose(
                [RECIPE],
                [discoveryRead('recipe', UNTITLED_ID, 'vocal')],
                intakeOf({ scopes: [trackScope(UNTITLED_ID, 'Audio 1')] })
            )
        );

        expect(answer.suggestion).toMatchObject({ targetId: UNTITLED_ID, recipeRole: 'vocal', roleSource: 'argument' });
    });

    it('offers the change for a discovered track among the tracks the question named', () => {
        const answer = accepted(
            compose(
                [RECIPE],
                [discoveryRead('recipe', VOCAL_ID)],
                intakeOf({ scopes: [trackScope(BASS_ID, 'Bass'), trackScope(VOCAL_ID, 'Lead Vocal')] })
            )
        );

        expect(answer.suggestion).toMatchObject({ targetId: VOCAL_ID });
        expect(answer.text.endsWith(` ${OFFER}`)).toBe(true);
    });

    it('keeps an answer that fits without the offer, dropping only the offer', () => {
        const offered = accepted(compose([RECIPE], [discoveryRead('recipe', VOCAL_ID)])).text;
        const recipeText = offered.slice(0, offered.length - OFFER.length - 1);
        // The most limitation paragraphs the recipe paragraph fits beside; the offer is longer than one.
        const fitting = Math.floor(
            (ANSWER_RESPOND_MAX_COMPOSED_CHARACTERS - recipeText.length) / (PERCEPTION_TEXT.length + 2)
        );
        const statements = [RECIPE, ...Array.from({ length: fitting }, () => PERCEPTION)];

        const answer = accepted(compose(statements, [discoveryRead('recipe', VOCAL_ID)]));

        expect(answer.suggestion).toBeUndefined();
        expect(answer.text).toBe([recipeText, ...Array.from({ length: fitting }, () => PERCEPTION_TEXT)].join('\n\n'));
        expect(answer.text.length).toBeLessThanOrEqual(ANSWER_RESPOND_MAX_COMPOSED_CHARACTERS);
        expect(answer.text.length + OFFER.length + 1).toBeGreaterThan(ANSWER_RESPOND_MAX_COMPOSED_CHARACTERS);
    });

    it('still limits an answer that does not fit even without the offer', () => {
        const offered = accepted(compose([RECIPE], [discoveryRead('recipe', VOCAL_ID)])).text;
        const recipeText = offered.slice(0, offered.length - OFFER.length - 1);
        const overflowing =
            Math.floor((ANSWER_RESPOND_MAX_COMPOSED_CHARACTERS - recipeText.length) / (PERCEPTION_TEXT.length + 2)) + 1;
        const statements = [RECIPE, ...Array.from({ length: overflowing }, () => PERCEPTION)];

        const answer = accepted(compose(statements, [discoveryRead('recipe', VOCAL_ID)]));

        expect(answer).toEqual({
            text: 'This answer is limited to the available bounded evidence.',
            evidence: expect.any(Array),
        });
    });

    it.each([
        {
            topic: 'level' as const,
            limitation:
                'A successful measurement covering the interpreted subject, range and metrics is unavailable. I cannot report audio figures for this question.',
        },
        {
            topic: 'timing' as const,
            limitation:
                'Track alignment and timing offsets are unavailable from these measurements. Source-buffer onsets do not establish track alignment.',
        },
    ])('offers nothing beside the limitation a measured $topic question answers with', ({ topic, limitation }) => {
        const intake = intakeOf({
            kind: 'measured-audio',
            topics: [topic],
            scopes: [trackScope(VOCAL_ID, 'Lead Vocal')],
        });

        const answer = accepted(compose([RECIPE], [discoveryRead('recipe', VOCAL_ID)], intake));

        expect(answer.suggestion).toBeUndefined();
        expect(answer.text).toBe(limitation);
    });
});
