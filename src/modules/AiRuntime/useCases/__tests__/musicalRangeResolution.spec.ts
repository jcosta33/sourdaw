import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveMusicalRange } from '#/modules/Arrangement/useCases';
import { timeSignatureMapStore } from '#/modules/Transport/stores';
import { getBarStartBeat } from '#/modules/Transport/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { materializeActionStateGuards } from '../materializeActionStateGuards';
import { parsePromptToActions } from '../parsePromptToActions';

import {
    discoverSearchedCalls,
    proposeDiscoveredCalls,
    scriptProviderTurns,
    searchCalls,
} from './highLevelIntentWorkflowFixture';

const runtimeMocks = vi.hoisted(() => ({ generateWebLlmCompletion: vi.fn() }));

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => ['webllm'],
}));
vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => 'webllm',
}));
vi.mock('../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: runtimeMocks.generateWebLlmCompletion,
}));
vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../..');

/** Verse, Chorus, Bridge, Chorus, and a section named outright "Chorus 2" for the exact-name row. */
const SECTIONS = [
    { id: 'section-verse', name: 'Verse', startBeat: 0, endBeat: 16 },
    { id: 'section-chorus-one', name: 'Chorus', startBeat: 16, endBeat: 32 },
    { id: 'section-bridge', name: 'Bridge', startBeat: 32, endBeat: 48 },
    { id: 'section-chorus-two', name: 'Chorus', startBeat: 48, endBeat: 64 },
    { id: 'section-last-verse', name: 'Verse 2', startBeat: 64, endBeat: 80 },
];

type RangeInput = Parameters<typeof resolveMusicalRange>[0];

function resolveIn(
    sections: RangeInput['sections'],
    range: RangeInput['range'],
    markers: RangeInput['markers'] = [],
    tracks: RangeInput['tracks'] = []
) {
    return resolveMusicalRange({ range, sections, markers, tracks, barStartBeat: getBarStartBeat });
}

/** An arrangement whose last clip ends on beat 96. */
const TRACKS_ENDING_AT_96 = [{ clips: [{ endBeat: 40 }] }, { clips: [{ endBeat: 96 }, { endBeat: 12 }] }];

/** Markers with no sections around them: two drops and a breakdown, the last drop running to the end. */
const DROP_MARKERS = [
    { id: 'marker-drop-one', name: 'Drop', beat: 16 },
    { id: 'marker-breakdown', name: 'Breakdown', beat: 32 },
    { id: 'marker-drop-two', name: 'Drop', beat: 64 },
];

/** The campaign's fixture project, with two sections both named "Chorus". */
function projectWithTwoChoruses(): ProjectContext {
    const fixture = JSON.parse(
        readFileSync(resolve(REPOSITORY_ROOT, 'evidence/agent-campaign/corpora/fixture-project.json'), 'utf8')
    ) as ProjectContext;
    return {
        ...fixture,
        sections: [
            { id: 'section-intro', name: 'Intro', startBeat: 0, endBeat: 16 },
            { id: 'section-verse', name: 'Verse', startBeat: 16, endBeat: 48 },
            { id: 'section-chorus-one', name: 'Chorus', startBeat: 48, endBeat: 80 },
            { id: 'section-verse-two', name: 'Verse', startBeat: 80, endBeat: 112 },
            { id: 'section-chorus-two', name: 'Chorus', startBeat: 112, endBeat: 144 },
        ],
    };
}

const leadVocalSelector = {
    targetArgument: 'trackId',
    entity: 'track',
    where: { name: 'Lead Vocal' },
    quantity: { unit: 'targets', exactly: 1 },
};

function scriptDip(section: string): void {
    scriptProviderTurns(runtimeMocks.generateWebLlmCompletion, [
        () => searchCalls(['dip a track level across a section']),
        discoverSearchedCalls(['automateParameterRange']),
        proposeDiscoveredCalls(
            [
                {
                    id: 'dip-vocal',
                    name: 'automateParameterRange',
                    arguments: {
                        parameterId: 'gain',
                        range: { section },
                        deltaDb: -6,
                        rampIn: 0.5,
                        rampOut: 0.5,
                    },
                    selector: leadVocalSelector,
                },
            ],
            ['automateParameterRange']
        ),
    ]);
}

describe('musical range resolution', () => {
    beforeEach(() => {
        runtimeMocks.generateWebLlmCompletion.mockReset();
        timeSignatureMapStore.set({ changes: [] });
    });

    afterEach(() => {
        timeSignatureMapStore.set({ changes: [] });
    });

    it('(a) converts bars to beats across a 4/4 to 7/8 change and a bar a mid-bar change shortens', () => {
        // 4/4 bars of 4 beats until beat 8, 7/8 bars of 3.5 beats after it, and a 3/4 change at
        // 16.5 that cuts bar 5 (15–18.5) short; bar 5 runs on through the 3/4 bar the change opens.
        timeSignatureMapStore.set({
            changes: [
                { id: 'seven-eight', beat: 8, numerator: 7, denominator: 8 },
                { id: 'three-four', beat: 16.5, numerator: 3, denominator: 4 },
            ],
        });

        expect([1, 2, 3, 4, 5, 6, 7].map(getBarStartBeat)).toEqual([0, 4, 8, 11.5, 15, 19.5, 22.5]);
        expect(resolveIn(SECTIONS, { startBar: 3, endBar: 4 })).toEqual({
            kind: 'resolved',
            startBeat: 8,
            endBeat: 15,
        });
        expect(resolveIn(SECTIONS, { startBar: 5, endBar: 5 })).toEqual({
            kind: 'resolved',
            startBeat: 15,
            endBeat: 19.5,
        });
        expect(resolveIn(SECTIONS, { startBar: 1, endBar: 2 })).toEqual({ kind: 'resolved', startBeat: 0, endBeat: 8 });
    });

    it('(b) resolves an ordinal among the sections of one name, written as a count or as a word', () => {
        const sections = SECTIONS.filter((section) => section.name !== 'Verse 2');
        const secondChorus = { kind: 'resolved', startBeat: 48, endBeat: 64 };

        expect(resolveIn(sections, { section: 'chorus 2' })).toMatchObject(secondChorus);
        expect(resolveIn(sections, { section: 'second chorus' })).toMatchObject(secondChorus);
        expect(resolveIn(sections, { section: 'the second chorus' })).toMatchObject(secondChorus);
        expect(resolveIn(sections, { section: 'the last chorus' })).toMatchObject(secondChorus);
        expect(resolveIn(sections, { section: 'first chorus' })).toMatchObject({ startBeat: 16, endBeat: 32 });
        expect(resolveIn(SECTIONS, { section: 'the last verse' })).toMatchObject({ startBeat: 64, endBeat: 80 });
    });

    it('(c) lets an exact section name win over the family it would otherwise count in', () => {
        const sections = [...SECTIONS, { id: 'section-named-chorus-2', name: 'Chorus 2', startBeat: 80, endBeat: 96 }];

        expect(resolveIn(sections, { section: 'Chorus 2' })).toMatchObject({
            kind: 'resolved',
            startBeat: 80,
            endBeat: 96,
            section: { id: 'section-named-chorus-2' },
        });
        expect(resolveIn(sections, { section: 'Bridge' })).toMatchObject({ startBeat: 32, endBeat: 48 });
    });

    it('(d) reports two equal matches as an ambiguous section with both candidates, and the planner asks which', async () => {
        expect(resolveIn(SECTIONS, { section: 'Chorus' })).toEqual({
            kind: 'ambiguous-section',
            reference: 'Chorus',
            candidates: [
                { id: 'section-chorus-one', name: 'Chorus', startBeat: 16, endBeat: 32 },
                { id: 'section-chorus-two', name: 'Chorus', startBeat: 48, endBeat: 64 },
            ],
            reason: expect.stringContaining('matches 2 sections equally') as unknown,
        });

        const context = projectWithTwoChoruses();
        const guarded = materializeActionStateGuards(
            [
                {
                    type: 'automateParameterRange',
                    payload: {
                        trackId: 'track-lead-vocal',
                        parameterId: 'gain',
                        range: { section: 'chorus' },
                        deltaDb: -6,
                    },
                },
            ],
            context
        );
        expect(guarded).toMatchObject({
            status: 'rejected',
            questions: [expect.stringContaining('from beat 48 to 80, or "Chorus" from beat 112 to 144')],
        });

        scriptDip('chorus');
        const result = await parsePromptToActions(
            'Dip the Lead Vocal by 6 dB in the chorus.',
            context,
            undefined,
            'revision-ambiguous-chorus'
        );

        expect(result.actions).toEqual([]);
        expect(result.planningOutcome).toMatchObject({
            kind: 'clarify',
            questions: [expect.stringContaining('Which part of the song do you mean by "chorus"')],
        });
    });

    it('proposes the range write through the registry route once the reference names one section', async () => {
        scriptDip('second chorus');
        const result = await parsePromptToActions(
            'Dip the Lead Vocal by 6 dB in the second chorus.',
            projectWithTwoChoruses(),
            undefined,
            'revision-second-chorus'
        );

        expect(result.planningOutcome).toEqual({ kind: 'proposal' });
        expect(result.actions).toEqual([
            {
                type: 'automateParameterRange',
                payload: {
                    trackId: 'track-lead-vocal',
                    parameterId: 'gain',
                    range: { section: 'second chorus' },
                    deltaDb: -6,
                    rampIn: 0.5,
                    rampOut: 0.5,
                    startBeat: 112,
                    endBeat: 144,
                },
            },
        ]);
    });

    it('(e) refuses an unknown section and a reversed bar range, and the planner does not ask about either', () => {
        expect(resolveIn(SECTIONS, { section: 'Drop' })).toMatchObject({ kind: 'unknown-section', reference: 'Drop' });
        expect(resolveIn(SECTIONS, { section: 'third chorus' })).toMatchObject({ kind: 'unknown-section' });
        expect(resolveIn(SECTIONS, { startBar: 6, endBar: 4 })).toMatchObject({ kind: 'invalid-range' });
        expect(resolveIn(SECTIONS, { startBeat: 12, endBeat: 4 })).toMatchObject({ kind: 'invalid-range' });
        expect(resolveIn(SECTIONS, { section: 'Verse', startBar: 1, endBar: 2 })).toMatchObject({
            kind: 'invalid-range',
        });

        for (const range of [{ section: 'Drop' }, { startBar: 6, endBar: 4 }]) {
            const guarded = materializeActionStateGuards(
                [
                    {
                        type: 'automateParameterRange',
                        payload: { trackId: 'track-lead-vocal', parameterId: 'gain', range, deltaDb: -6 },
                    },
                ],
                projectWithTwoChoruses()
            );
            expect(guarded.status).toBe('rejected');
            expect(guarded).not.toHaveProperty('questions');
        }
    });

    describe('markers', () => {
        it('runs a range a marker opens to the next marker', () => {
            expect(resolveIn([], { section: 'Breakdown' }, DROP_MARKERS, TRACKS_ENDING_AT_96)).toEqual({
                kind: 'resolved',
                startBeat: 32,
                endBeat: 64,
                section: { id: 'marker-breakdown', name: 'Breakdown', startBeat: 32, endBeat: 64 },
            });
        });

        it('ends a marker range at the next section start, and the last one at the end of the arrangement', () => {
            const sections = [{ id: 'section-outro', name: 'Outro', startBeat: 48, endBeat: 64 }];
            const markers = [
                { id: 'marker-build', name: 'Build', beat: 40 },
                { id: 'marker-tail', name: 'Tail', beat: 72 },
            ];

            expect(resolveIn(sections, { section: 'Build' }, markers, TRACKS_ENDING_AT_96)).toMatchObject({
                kind: 'resolved',
                startBeat: 40,
                endBeat: 48,
            });
            expect(resolveIn(sections, { section: 'Tail' }, markers, TRACKS_ENDING_AT_96)).toMatchObject({
                kind: 'resolved',
                startBeat: 72,
                endBeat: 96,
            });
            expect(resolveIn(sections, { section: 'Tail' }, markers, [])).toMatchObject({ kind: 'invalid-range' });
        });

        it('lets a section win over a marker of the same name', () => {
            const sections = [{ id: 'section-drop', name: 'Drop', startBeat: 80, endBeat: 96 }];

            expect(resolveIn(sections, { section: 'Drop' }, DROP_MARKERS, TRACKS_ENDING_AT_96)).toMatchObject({
                kind: 'resolved',
                startBeat: 80,
                endBeat: 96,
                section: { id: 'section-drop' },
            });
        });

        it('resolves an ordinal among markers of one name by beat', () => {
            const secondDrop = { kind: 'resolved', startBeat: 64, endBeat: 96, section: { id: 'marker-drop-two' } };

            expect(resolveIn([], { section: 'second drop' }, DROP_MARKERS, TRACKS_ENDING_AT_96)).toMatchObject(
                secondDrop
            );
            expect(resolveIn([], { section: 'drop 2' }, DROP_MARKERS, TRACKS_ENDING_AT_96)).toMatchObject(secondDrop);
            expect(resolveIn([], { section: 'first drop' }, DROP_MARKERS, TRACKS_ENDING_AT_96)).toMatchObject({
                startBeat: 16,
                endBeat: 32,
            });
        });

        it('reports two equal marker matches as an ambiguous section with both candidates', () => {
            expect(resolveIn([], { section: 'Drop' }, DROP_MARKERS, TRACKS_ENDING_AT_96)).toEqual({
                kind: 'ambiguous-section',
                reference: 'Drop',
                candidates: [
                    { id: 'marker-drop-one', name: 'Drop', startBeat: 16, endBeat: 32 },
                    { id: 'marker-drop-two', name: 'Drop', startBeat: 64, endBeat: 96 },
                ],
                reason: expect.stringContaining('matches 2 markers equally') as unknown,
            });
        });

        it('resolves a marker the planner sees in its project context', () => {
            const guarded = materializeActionStateGuards(
                [
                    {
                        type: 'automateParameterRange',
                        payload: {
                            trackId: 'track-lead-vocal',
                            parameterId: 'gain',
                            range: { section: 'Breakdown' },
                            deltaDb: -6,
                        },
                    },
                ],
                { ...projectWithTwoChoruses(), sections: [], markers: DROP_MARKERS }
            );

            expect(guarded).toMatchObject({
                status: 'accepted',
                actions: [{ type: 'automateParameterRange', payload: { startBeat: 32, endBeat: 64 } }],
            });
        });
    });
});
