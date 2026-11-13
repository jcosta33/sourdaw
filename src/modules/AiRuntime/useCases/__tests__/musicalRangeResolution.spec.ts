import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { resolveMusicalRange } from '#/modules/Arrangement/useCases';
import { timeSignatureMapStore } from '#/modules/Transport/stores';
import { getBarAtBeat, getBarStartBeat } from '#/modules/Transport/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { materializeActionStateGuards } from '../materializeActionStateGuards';
import { parsePromptToActions } from '../parsePromptToActions';

import {
    discoverSearchedCalls,
    proposeDiscoveredCalls,
    scriptProviderTurns,
    searchCalls,
} from './highLevelIntentWorkflowFixture';
import { literalMetricIntakeTurn } from './metricGoalWorkflowFixture';

registerDeviceEnginePorts();

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
    return resolveMusicalRange({
        range,
        sections,
        markers,
        tracks,
        barStartBeat: getBarStartBeat,
        barAtBeat: getBarAtBeat,
    });
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
    scriptDipRange({ section });
}

function scriptDipRange(range: Record<string, unknown>): void {
    scriptProviderTurns(runtimeMocks.generateWebLlmCompletion, [
        literalMetricIntakeTurn,
        () => searchCalls(['dip a track level across a section']),
        discoverSearchedCalls(['automateParameterRange']),
        proposeDiscoveredCalls(
            [
                {
                    id: 'dip-vocal',
                    name: 'automateParameterRange',
                    arguments: {
                        parameterId: 'gain',
                        range,
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

    it('reads a number written after the name as a name when the sections carry numbers, and a word ordinal as a position', () => {
        const numbered = [
            { id: 'section-chorus-1', name: 'Chorus 1', startBeat: 0, endBeat: 8 },
            { id: 'section-chorus-3', name: 'Chorus 3', startBeat: 16, endBeat: 24 },
        ];

        expect(resolveIn(numbered, { section: 'Chorus 2' })).toEqual({
            kind: 'unknown-section',
            reference: 'Chorus 2',
            reason: 'No section is named "Chorus 2"; the sections of that name are "Chorus 1" (beats 0–8), "Chorus 3" (beats 16–24).',
        });
        expect(resolveIn(numbered, { section: 'second chorus' })).toMatchObject({ startBeat: 16, endBeat: 24 });
        expect(resolveIn(numbered, { section: '2nd chorus' })).toMatchObject({ startBeat: 16, endBeat: 24 });
    });

    describe('ambiguity', () => {
        const numbered = [
            { id: 'section-chorus-1', name: 'Chorus 1', startBeat: 0, endBeat: 8 },
            { id: 'section-chorus-2', name: 'Chorus 2', startBeat: 16, endBeat: 24 },
        ];

        it('asks which numbered section a bare family name means', () => {
            expect(resolveIn(numbered, { section: 'chorus' })).toMatchObject({
                kind: 'ambiguous-section',
                candidates: [{ id: 'section-chorus-1' }, { id: 'section-chorus-2' }],
            });
        });

        it('asks which of two sections starting on the same beat an ordinal means', () => {
            const stacked = [
                { id: 'section-chorus-upper', name: 'Chorus', startBeat: 16, endBeat: 32 },
                { id: 'section-chorus-lower', name: 'Chorus', startBeat: 16, endBeat: 24 },
                { id: 'section-chorus-late', name: 'Chorus', startBeat: 48, endBeat: 64 },
            ];

            expect(resolveIn(stacked, { section: 'first chorus' })).toMatchObject({
                kind: 'ambiguous-section',
                candidates: [{ id: 'section-chorus-upper' }, { id: 'section-chorus-lower' }],
            });
        });

        describe('counts sections stacked on one start beat as one place when reading an ordinal', () => {
            const stackedFirst = [
                { id: 'section-chorus', name: 'Chorus', startBeat: 0, endBeat: 16 },
                { id: 'section-chorus-2', name: 'Chorus 2', startBeat: 0, endBeat: 8 },
                { id: 'section-chorus-3', name: 'Chorus 3', startBeat: 16, endBeat: 32 },
            ];
            const chorusThree = { kind: 'resolved', startBeat: 16, endBeat: 32, section: { id: 'section-chorus-3' } };

            it('asks which of the stacked pair "first chorus" means', () => {
                expect(resolveIn(stackedFirst, { section: 'first chorus' })).toMatchObject({
                    kind: 'ambiguous-section',
                    candidates: [{ id: 'section-chorus' }, { id: 'section-chorus-2' }],
                });
            });

            it('reads "second chorus" as the place after the stack', () => {
                expect(resolveIn(stackedFirst, { section: 'second chorus' })).toMatchObject(chorusThree);
            });

            it('reports "third chorus" as unknown, naming the two places of that name', () => {
                expect(resolveIn(stackedFirst, { section: 'third chorus' })).toEqual({
                    kind: 'unknown-section',
                    reference: 'third chorus',
                    reason: '"third chorus" names section 3 of its name, but the project has 2 places of that name.',
                });
            });

            it('reads "last chorus" as the last place', () => {
                expect(resolveIn(stackedFirst, { section: 'last chorus' })).toMatchObject(chorusThree);
            });
        });

        it('reads "final" as the last of its family', () => {
            expect(resolveIn(numbered, { section: 'final chorus' })).toMatchObject({
                kind: 'resolved',
                section: { id: 'section-chorus-2' },
            });
        });

        it('asks which of two sections bearing the same numbered name is meant', () => {
            const duplicated = [
                ...numbered,
                { id: 'section-chorus-2-again', name: 'Chorus 2', startBeat: 48, endBeat: 56 },
            ];

            expect(resolveIn(duplicated, { section: 'Chorus 2' })).toMatchObject({
                kind: 'ambiguous-section',
                candidates: [{ id: 'section-chorus-2' }, { id: 'section-chorus-2-again' }],
            });
        });
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
        const result = await parsePromptToActions({
            prompt: 'Dip the Lead Vocal by 6 dB in the chorus with 0.5 beat ramps in and out.',
            context,
            projectRevision: 'revision-ambiguous-chorus',
        });

        expect(result.actions).toEqual([]);
        expect(result.planningOutcome).toMatchObject({
            kind: 'clarify',
            questions: [expect.stringContaining('Which part of the song do you mean by "chorus"')],
        });
    });

    it('proposes the range write through the registry route once the reference names one section', async () => {
        scriptDip('second chorus');
        const result = await parsePromptToActions({
            prompt: 'Dip the Lead Vocal by 6 dB in the second chorus with 0.5 beat ramps in and out.',
            context: projectWithTwoChoruses(),
            projectRevision: 'revision-second-chorus',
        });

        expect(result.planningOutcome, JSON.stringify(result)).toEqual({ kind: 'proposal' });
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

    describe('the bars before a section and single bars', () => {
        // 4/4 bars of 4 beats to beat 8, a 3/4 bar of 3 beats (bar 3, beats 8–11), then 7/8 bars of
        // 3.5 beats from beat 11: bar 4 at 11, bar 5 at 14.5, bar 6 at 18, bar 7 at 21.5.
        const MIXED_METER_CHANGES = [
            { id: 'three-four', beat: 8, numerator: 3, denominator: 4 },
            { id: 'seven-eight', beat: 11, numerator: 7, denominator: 8 },
        ];
        const chorusAtBar7 = [{ id: 'section-chorus', name: 'Chorus', startBeat: 21.5, endBeat: 40 }];

        it('derives the bars across a meter change inside the range and one just before it', () => {
            timeSignatureMapStore.set({ changes: MIXED_METER_CHANGES });

            // Bars 4–6 run 11 to 21.5: the 7/8 change opens bar 4, the 3/4 change opens the bar before it.
            expect(resolveIn(chorusAtBar7, { section: 'Chorus', barsBefore: 3 })).toMatchObject({
                kind: 'resolved',
                startBeat: 11,
                endBeat: 21.5,
                section: { id: 'section-chorus' },
            });
            // Bar 6 alone is one 7/8 bar, 18 to 21.5.
            expect(resolveIn(chorusAtBar7, { section: 'Chorus', barsBefore: 1 })).toMatchObject({
                startBeat: 18,
                endBeat: 21.5,
            });
            // All six bars before the section are the whole of what comes before it: 0 to 21.5.
            expect(resolveIn(chorusAtBar7, { section: 'Chorus', barsBefore: 6 })).toMatchObject({
                startBeat: 0,
                endBeat: 21.5,
            });
        });

        it('refuses more bars than come before the section, naming how many do, and never clamps', () => {
            timeSignatureMapStore.set({ changes: MIXED_METER_CHANGES });

            const resolution = resolveIn(chorusAtBar7, { section: 'Chorus', barsBefore: 7 });

            expect(resolution).toMatchObject({ kind: 'invalid-range' });
            expect(resolution).toMatchObject({
                reason: expect.stringMatching(/"Chorus".*7 bars.*only 6 bars come before it/u) as unknown,
            });
        });

        it('refuses a section at bar 1, which has no bars before it', () => {
            const verseFirst = [{ id: 'section-verse', name: 'Verse', startBeat: 0, endBeat: 16 }];

            expect(resolveIn(verseFirst, { section: 'Verse', barsBefore: 1 })).toMatchObject({
                kind: 'invalid-range',
                reason: expect.stringMatching(/"Verse".*no bars come before it/u) as unknown,
            });
        });

        it('refuses a section that starts inside a bar, naming the bar', () => {
            // In 4/4, beat 18 is the third beat of bar 5 (16–20).
            const midBar = [{ id: 'section-pickup', name: 'Pickup', startBeat: 18, endBeat: 32 }];

            expect(resolveIn(midBar, { section: 'Pickup', barsBefore: 2 })).toMatchObject({
                kind: 'invalid-range',
                reason: expect.stringMatching(/"Pickup".*inside bar 5/u) as unknown,
            });
        });

        it('refuses a section that starts where a meter change cuts a bar short', () => {
            // 4/4 to beat 6, where a 3/4 change cuts bar 2 (4–8) short: the section opens no bar line.
            timeSignatureMapStore.set({ changes: [{ id: 'three-four', beat: 6, numerator: 3, denominator: 4 }] });
            const atChange = [{ id: 'section-at-change', name: 'Shift', startBeat: 6, endBeat: 12 }];

            expect(resolveIn(atChange, { section: 'Shift', barsBefore: 1 })).toMatchObject({
                kind: 'invalid-range',
                reason: expect.stringMatching(/"Shift".*inside bar 2/u) as unknown,
            });
        });

        it('reads a section whose own name carries a number whole', () => {
            // "Verse 2" starts at beat 64, bar 17 in 4/4: the four bars before it are bars 13–16, beats 48–64.
            expect(resolveIn(SECTIONS, { section: 'Verse 2', barsBefore: 4 })).toMatchObject({
                kind: 'resolved',
                startBeat: 48,
                endBeat: 64,
                section: { id: 'section-last-verse' },
            });
        });

        it('keeps the section reference refusals when the bars before are asked', () => {
            expect(resolveIn(SECTIONS, { section: 'Chorus', barsBefore: 2 })).toMatchObject({
                kind: 'ambiguous-section',
            });
            expect(resolveIn(SECTIONS, { section: 'Drop', barsBefore: 2 })).toMatchObject({ kind: 'unknown-section' });
        });

        it('refuses bars before that are not a whole count, or that no section anchors', () => {
            for (const barsBefore of [0, -1, 2.5, Number.NaN]) {
                expect(resolveIn(SECTIONS, { section: 'Verse 2', barsBefore })).toMatchObject({
                    kind: 'invalid-range',
                    reason: expect.stringContaining('whole number') as unknown,
                });
            }
            expect(resolveIn(SECTIONS, { barsBefore: 4 })).toMatchObject({ kind: 'invalid-range' });
            expect(resolveIn(SECTIONS, { startBar: 1, endBar: 2, barsBefore: 4 })).toMatchObject({
                kind: 'invalid-range',
            });
        });

        it('refuses a bar that opens at or after the end of the arrangement, naming the bar and the last one', () => {
            // The last clip ends on beat 96, where bar 25 would open: bar 24 is the last bar.
            const resolution = resolveIn(SECTIONS, { startBar: 25, endBar: 25 }, [], TRACKS_ENDING_AT_96);

            expect(resolution).toMatchObject({ kind: 'invalid-range' });
            expect(resolution).toMatchObject({
                reason: expect.stringMatching(/Bar 25.*last bar is bar 24/u) as unknown,
            });
            expect(resolveIn(SECTIONS, { startBar: 30, endBar: 31 }, [], TRACKS_ENDING_AT_96)).toMatchObject({
                kind: 'invalid-range',
            });
        });

        it('ends the last bar where the arrangement ends mid-bar', () => {
            // An end on beat 94 falls inside bar 24 (92–96), so bar 24 is the last bar and bar 25 is refused.
            const tracks = [{ clips: [{ endBeat: 94 }] }];

            expect(resolveIn(SECTIONS, { startBar: 24, endBar: 24 }, [], tracks)).toMatchObject({
                kind: 'resolved',
                startBeat: 92,
                endBeat: 96,
            });
            expect(resolveIn(SECTIONS, { startBar: 25, endBar: 25 }, [], tracks)).toMatchObject({
                kind: 'invalid-range',
                reason: expect.stringContaining('last bar is bar 24') as unknown,
            });
        });

        it('bounds no bar when the arrangement holds no clips, and admits a range that runs past the end as stated', () => {
            expect(resolveIn(SECTIONS, { startBar: 25, endBar: 25 }, [], [])).toEqual({
                kind: 'resolved',
                startBeat: 96,
                endBeat: 100,
            });
            // Bar 20 opens at beat 76, inside the song; the range runs on to beat 120, past its end at 96.
            expect(resolveIn(SECTIONS, { startBar: 20, endBar: 29 }, [], TRACKS_ENDING_AT_96)).toEqual({
                kind: 'resolved',
                startBeat: 76,
                endBeat: 116,
            });
        });

        it('proposes the bars before the second chorus with the beats the application derives', async () => {
            // The second chorus opens at beat 112, bar 29 in 4/4: the last four bars before it are bars 25–28.
            scriptDipRange({ section: 'second chorus', barsBefore: 4 });
            const result = await parsePromptToActions({
                prompt: 'Dip the Lead Vocal by 6 dB over the last 4 bars before the second chorus with 0.5 beat ramps in and out.',
                context: projectWithTwoChoruses(),
                projectRevision: 'revision-bars-before',
            });

            expect(result.planningOutcome, JSON.stringify(result)).toEqual({ kind: 'proposal' });
            expect(result.actions).toEqual([
                {
                    type: 'automateParameterRange',
                    payload: expect.objectContaining({
                        range: { section: 'second chorus', barsBefore: 4 },
                        startBeat: 96,
                        endBeat: 112,
                    }) as unknown,
                },
            ]);
        });

        it('grounds the same request when the provider states the bars itself, and reads a number word', async () => {
            scriptDipRange({ startBar: 25, endBar: 28 });
            const result = await parsePromptToActions({
                prompt: 'Dip the Lead Vocal by 6 dB during the final four bars before the second chorus with 0.5 beat ramps in and out.',
                context: projectWithTwoChoruses(),
                projectRevision: 'revision-bars-before-stated',
            });

            expect(result.planningOutcome, JSON.stringify(result)).toEqual({ kind: 'proposal' });
            expect(result.actions).toMatchObject([{ payload: { startBeat: 96, endBeat: 112 } }]);
        });

        it('reads the count from the prompt and the section whole when its name carries a number', async () => {
            // "Verse 2" opens on beat 16, bar 5: three bars before it are bars 2–4, beats 4–16.
            const context = {
                ...projectWithTwoChoruses(),
                sections: [
                    { id: 'section-intro', name: 'Intro', startBeat: 0, endBeat: 16 },
                    { id: 'section-verse-two', name: 'Verse 2', startBeat: 16, endBeat: 48 },
                ],
            };
            scriptDipRange({ section: 'Verse 2', barsBefore: 3 });
            const result = await parsePromptToActions({
                prompt: 'Dip the Lead Vocal by 6 dB across the last 3 bars before Verse 2 with 0.5 beat ramps in and out.',
                context,
                projectRevision: 'revision-bars-before-numbered',
            });

            expect(result.planningOutcome, JSON.stringify(result)).toEqual({ kind: 'proposal' });
            expect(result.actions).toMatchObject([{ payload: { startBeat: 4, endBeat: 16 } }]);
        });

        it('proposes a single bar as the bar line to the next', async () => {
            scriptDipRange({ startBar: 9, endBar: 9 });
            const result = await parsePromptToActions({
                prompt: 'Dip the Lead Vocal by 6 dB in bar 9 with 0.5 beat ramps in and out.',
                context: projectWithTwoChoruses(),
                projectRevision: 'revision-bar-nine',
            });

            expect(result.planningOutcome, JSON.stringify(result)).toEqual({ kind: 'proposal' });
            expect(result.actions).toMatchObject([{ payload: { startBeat: 32, endBeat: 36 } }]);
        });

        it("refuses a request for more bars than come before the section, carrying the law's reason", async () => {
            // Bars 1–28 come before the second chorus; 40 bars cannot be clamped to them.
            scriptDipRange({ section: 'second chorus', barsBefore: 40 });
            const result = await parsePromptToActions({
                prompt: 'Dip the Lead Vocal by 6 dB over the last 40 bars before the second chorus with 0.5 beat ramps in and out.',
                context: projectWithTwoChoruses(),
                projectRevision: 'revision-too-many-bars',
            });

            expect(result.actions).toEqual([]);
            expect(JSON.stringify(result)).toContain('only 28 bars come before it');
            expect(JSON.stringify(result)).not.toContain('does not match the user request');
        });
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
