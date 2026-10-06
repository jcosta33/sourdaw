import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { type MeasuredMetricEntry } from '../../models/MeasuredPreview';
import {
    type ProjectContext,
    type ProjectContextProductionBrief,
    type ProjectContextTrack,
} from '../../models/ProjectContext';
import { type VibeRunMeasurement } from '../../models/VibeRunPlan';
import { planWholeProjectVibeRun } from '../planWholeProjectVibeRun';

type MixRecipe = ReturnType<typeof getMixRecipeCatalog>['recipes'][number];
type PlannerContext = Pick<ProjectContext, 'tracks' | 'sections' | 'productionBrief'>;

function contextTrack(id: string, name: string, role: string | null): ProjectContextTrack {
    const track: ProjectContextTrack = {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 1,
        pan: 0,
        automationMode: 'read',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
    };
    if (role !== null) {
        track.canonicalRole = { role, source: 'test', evidence: name };
    }
    return track;
}

function brief(overrides: Partial<ProjectContextProductionBrief>): ProjectContextProductionBrief {
    return {
        schemaVersion: 1,
        id: 'brief-1',
        revision: 1,
        vision: null,
        references: [],
        hardConstraints: [],
        preferences: [],
        sectionGoals: [],
        trackRoles: [],
        locks: [],
        decisions: [],
        unresolvedQuestions: [],
        sourceRunLinks: [],
        supersedesBriefId: null,
        supersededByBriefId: null,
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    };
}

const RECIPE_TEMPLATE = (() => {
    const [template] = getMixRecipeCatalog().recipes;
    if (template === undefined) {
        throw new TypeError('The recipe catalog holds no recipe to shape a fixture from.');
    }
    return template;
})();

function recipe(
    id: string,
    descriptor: MixRecipe['descriptor'],
    roles: MixRecipe['roles'],
    metrics: MixRecipe['metrics']
): MixRecipe {
    return { ...RECIPE_TEMPLATE, id, descriptor, roles, metrics };
}

const WARM_ON_DRUMS_AND_BASS = recipe(
    'warm-source',
    'warm',
    ['drums', 'bass'],
    [
        { metric: 'spectralCentroid', direction: 'decrease' },
        { metric: 'frequencyBandEnergy', band: 'low-mid', direction: 'increase' },
        { metric: 'interTrackMasking', direction: 'hold' },
    ]
);
const WIDE_ON_VOCAL = recipe(
    'wide-vocal',
    'wide',
    ['vocal'],
    [{ metric: 'sideEnergyFraction', direction: 'increase' }]
);
const RECIPES = [WARM_ON_DRUMS_AND_BASS, WIDE_ON_VOCAL];

function figure(value: number): MeasuredMetricEntry {
    return { status: 'measured', metricVersion: 1, unit: 'unit', value, confidence: 'exact' };
}

function measurement(
    sectionId: string | null,
    targets: Record<string, Record<string, MeasuredMetricEntry>>
): VibeRunMeasurement {
    return {
        range: { sectionId },
        targets: Object.entries(targets).map(([targetId, measurements]) => ({ targetId, measurements })),
    };
}

function plan(context: PlannerContext, measurements: readonly VibeRunMeasurement[] = []) {
    return planWholeProjectVibeRun({ context, descriptors: ['warm'], recipes: RECIPES, measurements });
}

const NO_SECTIONS_CONTEXT: PlannerContext = {
    tracks: [contextTrack('t-kick', 'Kick', 'kick'), contextTrack('t-bass', 'Bass', 'bass')],
};

describe('planWholeProjectVibeRun roles', () => {
    it('reads each track role from its canonical role, never from its name', () => {
        const result = plan({
            tracks: [
                contextTrack('t-kick', 'Kick', 'kick'),
                contextTrack('t-bass', 'Bass', 'bass'),
                contextTrack('t-liar', 'Kick Layer', 'bass'),
                contextTrack('t-unknown', 'Bass Kick', null),
            ],
        });

        expect(result.batches.map((batch) => [batch.objective.role, batch.targetIds])).toEqual([
            ['drums', ['t-kick']],
            ['bass', ['t-bass', 't-liar']],
        ]);
        expect(result.unclassifiedTargetIds).toEqual(['t-unknown']);
    });

    it('orders role families the way the selector vocabulary does, whatever order the tracks sit in', () => {
        const result = plan({
            tracks: [contextTrack('t-bass', 'Bass', 'bass'), contextTrack('t-kick', 'Kick', 'kick')],
        });

        expect(result.batches.map((batch) => batch.objective.role)).toEqual(['drums', 'bass']);
        expect(result.batches.map((batch) => batch.ordinal)).toEqual([1, 2]);
    });
});

describe('planWholeProjectVibeRun scope', () => {
    it('plans a project whose sections and groups are named nothing a planner could expect', () => {
        const result = plan({
            tracks: NO_SECTIONS_CONTEXT.tracks,
            sections: [
                { id: 's-b', name: 'Part B', startBeat: 16, endBeat: 32 },
                { id: 's-a', name: 'Part A', startBeat: 0, endBeat: 16 },
            ],
        });

        expect(result.batches).toHaveLength(2);
        for (const batch of result.batches) {
            expect(batch.objective.sections).toEqual([
                { id: 's-a', startBeat: 0, endBeat: 16 },
                { id: 's-b', startBeat: 16, endBeat: 32 },
            ]);
        }
    });

    it('plans a project that has no sections over the whole project', () => {
        const result = plan(NO_SECTIONS_CONTEXT);

        expect(result.batches).toHaveLength(2);
        expect(result.batches.every((batch) => batch.objective.sections.length === 0)).toBe(true);
    });

    it('carries the brief revision and the goals of the sections in scope, and leaves a locked track alone', () => {
        const productionBrief = brief({
            revision: 7,
            sectionGoals: [
                { id: 'g1', sectionId: 's-a', statement: 'Stay sparse', createdAt: 0 },
                { id: 'g2', sectionId: 'missing', statement: 'Not in this project', createdAt: 0 },
            ],
            locks: [
                {
                    id: 'l1',
                    scope: { kind: 'track', trackId: 't-bass' },
                    statement: 'Leave the bass alone',
                    createdAt: 0,
                },
            ],
        });

        const result = plan({
            tracks: NO_SECTIONS_CONTEXT.tracks,
            sections: [{ id: 's-a', name: 'Part A', startBeat: 0, endBeat: 16 }],
            productionBrief,
        });

        expect(result.briefRevision).toBe(7);
        expect(result.lockedTargetIds).toEqual(['t-bass']);
        expect(result.batches.map((batch) => batch.targetIds)).toEqual([['t-kick']]);
        expect(result.batches[0]?.objective.sectionGoals).toEqual([{ sectionId: 's-a', statement: 'Stay sparse' }]);
    });

    it('reports no brief revision when the project holds no brief', () => {
        expect(plan(NO_SECTIONS_CONTEXT).briefRevision).toBeNull();
    });
});

describe('planWholeProjectVibeRun baselines', () => {
    const tracks = [
        contextTrack('t-kick', 'Kick', 'kick'),
        contextTrack('t-snare', 'Snare', 'snare'),
        contextTrack('t-bass', 'Bass', 'bass'),
    ];
    const sections = [
        { id: 's-a', name: 'Part A', startBeat: 0, endBeat: 16 },
        { id: 's-b', name: 'Part B', startBeat: 16, endBeat: 32 },
    ];

    it('carries each target figure per section, limited to the metrics the batch expects to move', () => {
        const result = plan({ tracks, sections }, [
            measurement('s-a', {
                't-kick': { spectralCentroid: figure(1200), integratedLoudness: figure(-14) },
                't-bass': { spectralCentroid: figure(300) },
            }),
            measurement('s-b', { 't-kick': { spectralCentroid: figure(1500) } }),
            measurement('gone', { 't-kick': { spectralCentroid: figure(1) } }),
        ]);

        const [drums, bass] = result.batches;
        expect(drums?.baselines).toEqual([
            { targetId: 't-kick', sectionId: 's-a', measurements: { spectralCentroid: figure(1200) } },
            { targetId: 't-kick', sectionId: 's-b', measurements: { spectralCentroid: figure(1500) } },
        ]);
        expect(bass?.baselines).toEqual([
            { targetId: 't-bass', sectionId: 's-a', measurements: { spectralCentroid: figure(300) } },
        ]);
    });

    it('names the targets no measurement covers instead of inventing a baseline', () => {
        const result = plan({ tracks, sections }, [
            measurement('s-a', { 't-kick': { spectralCentroid: figure(1200) } }),
        ]);

        expect(result.batches[0]?.unmeasuredTargetIds).toEqual(['t-snare']);
        expect(result.batches[1]?.unmeasuredTargetIds).toEqual(['t-bass']);
    });

    it('takes a whole-project measurement as the baseline of every section', () => {
        const result = plan({ tracks, sections }, [measurement(null, { 't-bass': { spectralCentroid: figure(310) } })]);

        expect(result.batches[1]?.baselines).toEqual([
            { targetId: 't-bass', sectionId: null, measurements: { spectralCentroid: figure(310) } },
        ]);
    });
});

describe('planWholeProjectVibeRun batches', () => {
    it.each([
        { trackCount: 24, batchCount: 1 },
        { trackCount: 25, batchCount: 2 },
        { trackCount: 60, batchCount: 3 },
    ])('splits $trackCount tracks of one role into $batchCount batches of at most 24 targets', (row) => {
        const tracks = Array.from({ length: row.trackCount }, (_, index) =>
            contextTrack(`t-${String(index)}`, `Kick ${String(index)}`, 'kick')
        );

        const result = plan({ tracks });

        expect(result.batches).toHaveLength(row.batchCount);
        for (const batch of result.batches) {
            expect(batch.targetIds.length).toBeLessThanOrEqual(24);
            expect(batch.targetIds.length).toBeGreaterThan(0);
        }
        expect(result.batches.flatMap((batch) => batch.targetIds)).toEqual(tracks.map((track) => track.id));
        expect(new Set(result.batches.map((batch) => batch.id)).size).toBe(row.batchCount);
    });

    it('gives every batch an objective and the measurable deltas its recipes expect, with their direction', () => {
        const result = plan(NO_SECTIONS_CONTEXT);

        for (const batch of result.batches) {
            expect(batch.objective.descriptors).toEqual(['warm']);
            expect(batch.objective.recipeIds).toEqual(['warm-source']);
            expect(batch.expectedDeltas).toEqual([
                { descriptor: 'warm', metric: 'spectralCentroid', band: null, direction: 'decrease' },
                { descriptor: 'warm', metric: 'frequencyBandEnergy', band: 'low-mid', direction: 'increase' },
            ]);
        }
    });

    it('reports a role no requested character has a measurable recipe for instead of planning an empty batch', () => {
        const result = plan({
            tracks: [contextTrack('t-kick', 'Kick', 'kick'), contextTrack('t-lead', 'Lead', 'lead vocal')],
        });

        expect(result.batches.map((batch) => batch.objective.role)).toEqual(['drums']);
        expect(result.unplannedRoles).toEqual([{ role: 'vocal', reason: 'no-expected-deltas', targetIds: ['t-lead'] }]);
    });

    it('plans nothing when the request names no character', () => {
        const result = planWholeProjectVibeRun({
            context: NO_SECTIONS_CONTEXT,
            descriptors: [],
            recipes: RECIPES,
            measurements: [],
        });

        expect(result.batches).toEqual([]);
        expect(result.unplannedRoles.map((entry) => entry.role)).toEqual(['drums', 'bass']);
    });
});

describe('planWholeProjectVibeRun source', () => {
    it('names no section or output group: every scope comes from roles and the project sections', () => {
        const forbiddenName =
            /chorus|verse|bridge|intro|outro|breakdown|\bdrop\b|\bhook\b|\bbus(?:es)?\b|\bdrums?\b|\bbass\b/iu;
        for (const file of ['../planWholeProjectVibeRun.ts', '../../models/VibeRunPlan.ts']) {
            const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');

            expect(source).not.toMatch(forbiddenName);
        }
    });
});
