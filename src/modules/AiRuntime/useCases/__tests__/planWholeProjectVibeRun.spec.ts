import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { MAX_LLM_ACTIONS_PER_BATCH } from '../../models/LlmActionLimits';
import { type MeasuredMetricEntry } from '../../models/MeasuredPreview';
import {
    type ProjectContext,
    type ProjectContextProductionBrief,
    type ProjectContextTrack,
} from '../../models/ProjectContext';
import { RECIPE_EXPANSION_MAX_COMMANDS } from '../../models/RecipeExpansionLimits';
import { type VibeRunBatch, type VibeRunMeasurement } from '../../models/VibeRunPlan';
import { expandMixRecipe } from '../expandMixRecipe';
import { planWholeProjectVibeRun } from '../planWholeProjectVibeRun';

type MixRecipe = ReturnType<typeof getMixRecipeCatalog>['recipes'][number];
type PlannerContext = Pick<ProjectContext, 'tracks' | 'sections' | 'productionBrief'>;
type MeasurementWindow = VibeRunMeasurement['range'];

function contextTrack(
    id: string,
    name: string,
    role: string | null,
    overrides: Partial<ProjectContextTrack> = {}
): ProjectContextTrack {
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
        ...overrides,
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

function projectContext(tracks: ProjectContextTrack[]): ProjectContext {
    return {
        tempo: 120,
        timeSignature: [4, 4],
        isPlaying: false,
        isRecording: false,
        isLooping: false,
        loopStart: 0,
        loopEnd: 0,
        punchInEnabled: false,
        punchInBeat: 0,
        punchOutBeat: 16,
        metronomeEnabled: false,
        metronomeVolume: 0.5,
        masterGain: 0.8,
        tracks,
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
    };
}

const CATALOG_RECIPES = getMixRecipeCatalog().recipes;

function catalogRecipe(id: string): MixRecipe {
    const found = CATALOG_RECIPES.find((candidate) => candidate.id === id);
    if (found === undefined) {
        throw new TypeError(`The recipe catalog holds no recipe "${id}".`);
    }
    return found;
}

/** A recipe that expands to as many commands as it has parameters plus its one inserted device. */
function synthetic(
    id: string,
    descriptor: MixRecipe['descriptor'],
    roles: MixRecipe['roles'],
    metrics: MixRecipe['metrics'],
    parameterCount = 0
): MixRecipe {
    const parameters = Array.from({ length: parameterCount }, (_, index) => ({
        paramId: `p${String(index)}`,
        minimum: 0,
        maximum: 1,
    }));
    return {
        ...catalogRecipe('drums-warm'),
        id,
        descriptor,
        roles,
        metrics,
        steps: [{ kind: 'insert', deviceType: 'builtin-eq', parameters }],
    };
}

const WARM_ON_DRUMS_AND_BASS = synthetic(
    'warm-source',
    'warm',
    ['drums', 'bass'],
    [
        { metric: 'spectralCentroid', direction: 'decrease' },
        { metric: 'frequencyBandEnergy', band: 'low-mid', direction: 'increase' },
        { metric: 'interTrackMasking', direction: 'hold' },
    ]
);
const WIDE_ON_VOCAL = synthetic(
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
    range: MeasurementWindow,
    targets: Record<string, Record<string, MeasuredMetricEntry>>
): VibeRunMeasurement {
    return {
        range,
        targets: Object.entries(targets).map(([targetId, measurements]) => ({ targetId, measurements })),
    };
}

function window(startBeat: number, endBeat: number, sectionId: string | null = null): MeasurementWindow {
    return { startBeat, endBeat, sectionId };
}

function plan(context: PlannerContext, measurements: readonly VibeRunMeasurement[] = []) {
    return planWholeProjectVibeRun({ context, descriptors: ['warm'], recipes: RECIPES, measurements });
}

function planCatalogWarmDrums(context: PlannerContext) {
    return planWholeProjectVibeRun({
        context,
        descriptors: ['warm'],
        recipes: [catalogRecipe('drums-warm')],
        measurements: [],
    });
}

/** What `recipe.expand` adds for every target and recipe the batch names, read from the expander itself. */
function expandBatch(batch: VibeRunBatch, context: ProjectContext): number {
    let total = 0;
    let ordinal = 0;
    for (const { targetId, recipeIds } of batch.targets) {
        for (const recipeId of recipeIds) {
            const result = expandMixRecipe({ recipeId, targetId, role: null, values: [] }, context, ordinal);
            if (result.status === 'refused') {
                throw new TypeError(result.reason);
            }
            ordinal += 1;
            total += result.commands.length;
        }
    }
    return total;
}

function plannedTargetIds(result: ReturnType<typeof plan>): string[] {
    return result.batches.flatMap((batch) => batch.targetIds);
}

const NO_SECTIONS_CONTEXT: PlannerContext = {
    tracks: [contextTrack('t-kick', 'Kick', 'kick'), contextTrack('t-bass', 'Bass', 'bass')],
};

const SECTION_A = { id: 's-a', name: 'Part A', startBeat: 0, endBeat: 16 };
const SECTION_B = { id: 's-b', name: 'Part B', startBeat: 16, endBeat: 32 };
const TWO_SECTIONS = [SECTION_A, SECTION_B];

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
        expect(result.excludedTargets).toEqual([{ targetId: 't-unknown', reason: 'unclassified-role' }]);
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
        const result = plan({ tracks: NO_SECTIONS_CONTEXT.tracks, sections: [SECTION_B, SECTION_A] });

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

    it('carries the brief revision and the goals of the sections in scope', () => {
        const productionBrief = brief({
            revision: 7,
            sectionGoals: [
                { id: 'g1', sectionId: 's-a', statement: 'Stay sparse', createdAt: 0 },
                { id: 'g2', sectionId: 'missing', statement: 'Not in this project', createdAt: 0 },
            ],
        });

        const result = plan({ tracks: NO_SECTIONS_CONTEXT.tracks, sections: [SECTION_A], productionBrief });

        expect(result.briefRevision).toBe(7);
        expect(result.batches[0]?.objective.sectionGoals).toEqual([{ sectionId: 's-a', statement: 'Stay sparse' }]);
    });

    it('reports no brief revision when the project holds no brief', () => {
        expect(plan(NO_SECTIONS_CONTEXT).briefRevision).toBeNull();
    });
});

describe('planWholeProjectVibeRun protected tracks', () => {
    const tracks = [
        contextTrack('t-kick', 'Kick', 'kick', {
            clips: [{ id: 'clip-kick', name: 'Kick loop', type: 'audio', startBeat: 0, endBeat: 8, noteCount: 0 }],
            devices: [{ id: 'dev-kick-eq', type: 'builtin-eq', bypassed: false }],
        }),
        contextTrack('t-bass', 'Bass', 'bass'),
    ];

    function scopedBrief(overrides: Partial<ProjectContextProductionBrief>) {
        return plan({ tracks, productionBrief: brief(overrides) });
    }

    const lockOn = (scope: ProjectContextProductionBrief['locks'][number]['scope']) => ({
        locks: [{ id: 'lock-1', scope, statement: 'Hands off', createdAt: 0 }],
    });
    const decisionOn = (
        scope: ProjectContextProductionBrief['locks'][number]['scope'],
        status: ProjectContextProductionBrief['decisions'][number]['status']
    ) => ({
        decisions: [
            {
                id: 'decision-1',
                scope,
                statement: 'Keep it',
                rationale: null,
                status,
                sourceRunId: null,
                relatedBatchId: null,
                supersededByDecisionId: null,
                createdAt: 0,
            },
        ],
    });

    it.each([
        { name: 'a track lock', overrides: lockOn({ kind: 'track', trackId: 't-bass' }), protectedId: 't-bass' },
        {
            name: 'a locked decision',
            overrides: decisionOn({ kind: 'track', trackId: 't-bass' }, 'locked'),
            protectedId: 't-bass',
        },
        {
            name: 'an object lock naming the track',
            overrides: lockOn({ kind: 'object', objectType: 'track', objectId: 't-bass' }),
            protectedId: 't-bass',
        },
        {
            name: 'an object lock naming a device the track holds',
            overrides: lockOn({ kind: 'object', objectType: 'device', objectId: 'dev-kick-eq' }),
            protectedId: 't-kick',
        },
        {
            name: 'an object lock naming a clip the track holds',
            overrides: lockOn({ kind: 'object', objectType: 'clip', objectId: 'clip-kick' }),
            protectedId: 't-kick',
        },
    ])('keeps a track out of every batch under $name', ({ overrides, protectedId }) => {
        const result = scopedBrief(overrides);

        expect(plannedTargetIds(result)).not.toContain(protectedId);
        expect(result.excludedTargets).toEqual([{ targetId: protectedId, reason: 'protected' }]);
        expect(plannedTargetIds(result)).toHaveLength(1);
    });

    it('keeps every track out under a project lock', () => {
        const result = scopedBrief(lockOn({ kind: 'project' }));

        expect(result.batches).toEqual([]);
        expect(result.excludedTargets).toEqual([
            { targetId: 't-kick', reason: 'protected' },
            { targetId: 't-bass', reason: 'protected' },
        ]);
    });

    it('does not protect a track a decision that is not locked names', () => {
        const result = scopedBrief(decisionOn({ kind: 'track', trackId: 't-bass' }, 'accepted'));

        expect(plannedTargetIds(result)).toEqual(['t-kick', 't-bass']);
        expect(result.excludedTargets).toEqual([]);
    });
});

describe('planWholeProjectVibeRun tracks recipe.expand refuses', () => {
    const folder = contextTrack('t-folder', 'Drums', 'drums', { kind: 'folder' });
    const frozen = contextTrack('t-frozen', 'Frozen Kick', 'kick', { frozen: true });
    const kick = contextTrack('t-kick', 'Kick', 'kick');
    const context = projectContext([folder, frozen, kick]);

    function expandRefusal(targetId: string): string | null {
        const result = expandMixRecipe({ recipeId: 'drums-warm', targetId, role: null, values: [] }, context, 0);
        return result.status === 'refused' ? result.reason : null;
    }

    it('leaves a folder track out of every batch and reports it', () => {
        const result = planCatalogWarmDrums(context);

        expect(result.excludedTargets).toContainEqual({ targetId: 't-folder', reason: 'folder' });
        expect(plannedTargetIds(result)).not.toContain('t-folder');
        expect(expandRefusal('t-folder')).toContain('folder');
    });

    it('leaves a frozen track out of every batch and reports it', () => {
        const result = planCatalogWarmDrums(context);

        expect(result.excludedTargets).toContainEqual({ targetId: 't-frozen', reason: 'frozen' });
        expect(plannedTargetIds(result)).not.toContain('t-frozen');
        expect(expandRefusal('t-frozen')).toContain('frozen');
    });

    it('plans the track recipe.expand accepts', () => {
        const result = planCatalogWarmDrums(context);

        expect(plannedTargetIds(result)).toEqual(['t-kick']);
        expect(expandRefusal('t-kick')).toBeNull();
    });

    it('leaves out a track a retune recipe has no single live device to retune on', () => {
        const compressor = { id: 'dev-comp', type: 'builtin-compressor', bypassed: false };
        const withCompressor = contextTrack('t-bus-ready', 'Group A', 'bus', { devices: [compressor] });
        const bare = contextTrack('t-bus-bare', 'Group B', 'bus');
        const bypassed = contextTrack('t-bus-bypassed', 'Group C', 'bus', {
            devices: [{ ...compressor, id: 'dev-comp-off', bypassed: true }],
        });
        const busContext = projectContext([withCompressor, bare, bypassed]);

        const result = planWholeProjectVibeRun({
            context: busContext,
            descriptors: ['punchy'],
            recipes: [catalogRecipe('bus-punchy')],
            measurements: [],
        });

        expect(plannedTargetIds(result)).toEqual(['t-bus-ready']);
        expect(result.excludedTargets).toEqual([
            { targetId: 't-bus-bare', reason: 'no-applicable-recipe' },
            { targetId: 't-bus-bypassed', reason: 'no-applicable-recipe' },
        ]);
        for (const targetId of ['t-bus-bare', 't-bus-bypassed']) {
            const refusal = expandMixRecipe(
                { recipeId: 'bus-punchy', targetId, role: null, values: [] },
                busContext,
                0
            );
            expect(refusal.status).toBe('refused');
        }
    });
});

describe('planWholeProjectVibeRun baselines', () => {
    const tracks = [
        contextTrack('t-kick', 'Kick', 'kick'),
        contextTrack('t-snare', 'Snare', 'snare'),
        contextTrack('t-bass', 'Bass', 'bass'),
    ];
    const sections = TWO_SECTIONS;

    it('carries each target figure per section, limited to the metrics the batch expects to move', () => {
        const result = plan({ tracks, sections }, [
            measurement(window(0, 16, 's-a'), {
                't-kick': { spectralCentroid: figure(1200), integratedLoudness: figure(-14) },
                't-bass': { spectralCentroid: figure(300) },
            }),
            measurement(window(16, 32, 's-b'), { 't-kick': { spectralCentroid: figure(1500) } }),
            measurement(window(100, 116, 'gone'), { 't-kick': { spectralCentroid: figure(1) } }),
        ]);

        const [drums, bass] = result.batches;
        expect(drums?.baselines).toEqual([
            {
                targetId: 't-kick',
                sectionId: 's-a',
                window: { startBeat: 0, endBeat: 16 },
                measurements: { spectralCentroid: figure(1200) },
            },
            {
                targetId: 't-kick',
                sectionId: 's-b',
                window: { startBeat: 16, endBeat: 32 },
                measurements: { spectralCentroid: figure(1500) },
            },
        ]);
        expect(bass?.baselines).toEqual([
            {
                targetId: 't-bass',
                sectionId: 's-a',
                window: { startBeat: 0, endBeat: 16 },
                measurements: { spectralCentroid: figure(300) },
            },
        ]);
    });

    it('names the targets no measurement covers instead of inventing a baseline', () => {
        const result = plan({ tracks, sections }, [
            measurement(window(0, 16, 's-a'), { 't-kick': { spectralCentroid: figure(1200) } }),
        ]);

        expect(result.batches[0]?.unmeasuredTargetIds).toEqual(['t-snare']);
        expect(result.batches[1]?.unmeasuredTargetIds).toEqual(['t-bass']);
    });

    it('never takes a short beat window as the baseline of the sections it only partly covers', () => {
        const result = plan({ tracks, sections }, [
            measurement(window(0, 4), { 't-kick': { spectralCentroid: figure(900) } }),
            measurement(window(4, 8), { 't-kick': { spectralCentroid: figure(1800) } }),
        ]);

        expect(result.batches[0]?.baselines).toEqual([]);
        expect(result.batches[0]?.unmeasuredTargetIds).toEqual(['t-kick', 't-snare']);
        expect(result.batches[0]?.baselineConflicts).toEqual([]);
    });

    it('takes a window that fully covers sections as the baseline of each, and keeps the window it rendered', () => {
        const result = plan({ tracks, sections }, [
            measurement(window(0, 32), { 't-bass': { spectralCentroid: figure(310) } }),
        ]);

        expect(result.batches[1]?.baselines).toEqual([
            {
                targetId: 't-bass',
                sectionId: 's-a',
                window: { startBeat: 0, endBeat: 32 },
                measurements: { spectralCentroid: figure(310) },
            },
            {
                targetId: 't-bass',
                sectionId: 's-b',
                window: { startBeat: 0, endBeat: 32 },
                measurements: { spectralCentroid: figure(310) },
            },
        ]);
    });

    it('prefers the figure rendered over exactly the section to a wider window that contains it', () => {
        const result = plan({ tracks, sections }, [
            measurement(window(0, 32), { 't-bass': { spectralCentroid: figure(310) } }),
            measurement(window(0, 16), { 't-bass': { spectralCentroid: figure(280) } }),
        ]);

        const baselines = result.batches[1]?.baselines ?? [];
        expect(baselines.find((baseline) => baseline.sectionId === 's-a')?.measurements).toEqual({
            spectralCentroid: figure(280),
        });
        expect(baselines.find((baseline) => baseline.sectionId === 's-b')?.measurements).toEqual({
            spectralCentroid: figure(310),
        });
    });

    it('reports a conflict, and stands neither figure, when two windows answer for one target and section', () => {
        const result = plan({ tracks, sections }, [
            measurement(window(0, 20), { 't-bass': { spectralCentroid: figure(310) } }),
            measurement(window(-8, 16), { 't-bass': { spectralCentroid: figure(280) } }),
        ]);

        const bass = result.batches[1];
        expect(bass?.baselineConflicts).toEqual([{ targetId: 't-bass', sectionId: 's-a' }]);
        expect(bass?.baselines.filter((baseline) => baseline.sectionId === 's-a')).toEqual([]);
    });

    it('reports a conflict when two measurements of exactly the section disagree', () => {
        const result = plan({ tracks, sections }, [
            measurement(window(0, 16, 's-a'), { 't-bass': { spectralCentroid: figure(310) } }),
            measurement(window(0, 16), { 't-bass': { spectralCentroid: figure(280) } }),
        ]);

        expect(result.batches[1]?.baselineConflicts).toEqual([{ targetId: 't-bass', sectionId: 's-a' }]);
        expect(result.batches[1]?.baselines).toEqual([]);
    });

    it('carries no baseline when the project has no section a window could cover', () => {
        const result = plan({ tracks }, [measurement(window(0, 32), { 't-bass': { spectralCentroid: figure(310) } })]);

        expect(result.batches.every((batch) => batch.baselines.length === 0)).toBe(true);
        expect(result.batches[1]?.unmeasuredTargetIds).toEqual(['t-bass']);
    });
});

describe('planWholeProjectVibeRun batches', () => {
    it.each([
        { trackCount: 24, batchCount: 1 },
        { trackCount: 25, batchCount: 2 },
        { trackCount: 60, batchCount: 3 },
    ])('splits $trackCount one-command targets of one role into $batchCount batches', (row) => {
        const tracks = Array.from({ length: row.trackCount }, (_, index) =>
            contextTrack(`t-${String(index)}`, `Kick ${String(index)}`, 'kick')
        );

        const result = plan({ tracks });

        expect(result.batches).toHaveLength(row.batchCount);
        for (const batch of result.batches) {
            expect(batch.commandCount).toBeLessThanOrEqual(MAX_LLM_ACTIONS_PER_BATCH);
            expect(batch.targetIds.length).toBeGreaterThan(0);
        }
        expect(plannedTargetIds(result)).toEqual(tracks.map((track) => track.id));
        expect(new Set(result.batches.map((batch) => batch.id)).size).toBe(row.batchCount);
    });

    it('sizes batches by the commands the catalogue recipe expands to, so 24 kicks never share one batch', () => {
        const tracks = Array.from({ length: 24 }, (_, index) =>
            contextTrack(`t-${String(index)}`, `Kick ${String(index)}`, 'kick')
        );
        const context = projectContext(tracks);

        const result = planCatalogWarmDrums(context);

        expect(result.batches.length).toBeGreaterThan(1);
        expect(plannedTargetIds(result)).toEqual(tracks.map((track) => track.id));
        for (const batch of result.batches) {
            const expanded = expandBatch(batch, context);
            expect(expanded).toBe(batch.commandCount);
            expect(expanded).toBeLessThanOrEqual(MAX_LLM_ACTIONS_PER_BATCH);
        }
    });

    it('adds up every recipe a batch carries on each target', () => {
        const tracks = Array.from({ length: 6 }, (_, index) =>
            contextTrack(`t-${String(index)}`, `Kick ${String(index)}`, 'kick')
        );
        const context = projectContext(tracks);

        const result = planWholeProjectVibeRun({
            context,
            descriptors: ['warm', 'bright'],
            recipes: [catalogRecipe('drums-warm'), catalogRecipe('drums-bright')],
            measurements: [],
        });

        for (const batch of result.batches) {
            for (const target of batch.targets) {
                expect(target.recipeIds).toEqual(['drums-warm', 'drums-bright']);
            }
            expect(expandBatch(batch, context)).toBe(batch.commandCount);
            expect(batch.commandCount).toBeLessThanOrEqual(MAX_LLM_ACTIONS_PER_BATCH);
        }
    });

    it('reports a target whose recipes alone pass the cap instead of emitting a batch the run would refuse', () => {
        const heavy = [
            synthetic('heavy-warm', 'warm', ['drums'], [{ metric: 'spectralCentroid', direction: 'decrease' }], 14),
            synthetic('heavy-bright', 'bright', ['drums'], [{ metric: 'spectralCentroid', direction: 'increase' }], 14),
        ];

        const result = planWholeProjectVibeRun({
            context: { tracks: [contextTrack('t-kick', 'Kick', 'kick'), contextTrack('t-bass', 'Bass', 'bass')] },
            descriptors: ['warm', 'bright'],
            recipes: heavy,
            measurements: [],
        });

        expect(result.batches).toEqual([]);
        expect(result.unplannedRoles).toContainEqual({
            role: 'drums',
            reason: 'target-exceeds-batch-cap',
            targetIds: ['t-kick'],
        });
    });

    it('gives every batch an objective and the measurable deltas its recipes expect, with their direction', () => {
        const result = plan(NO_SECTIONS_CONTEXT);

        for (const batch of result.batches) {
            expect(batch.objective.descriptors).toEqual(['warm']);
            for (const target of batch.targets) {
                expect(target.recipeIds).toEqual(['warm-source']);
                expect(target.expectedDeltas).toEqual([
                    { descriptor: 'warm', metric: 'spectralCentroid', band: null, direction: 'decrease' },
                    { descriptor: 'warm', metric: 'frequencyBandEnergy', band: 'low-mid', direction: 'increase' },
                ]);
            }
        }
    });

    it('plans only the recipes whose metrics analysis.measure can report', () => {
        const measurable = synthetic(
            'warm-measurable',
            'warm',
            ['drums'],
            [{ metric: 'spectralCentroid', direction: 'decrease' }]
        );
        const unmeasurable = synthetic(
            'warm-unmeasurable',
            'warm',
            ['drums'],
            [{ metric: 'spectralRolloff', direction: 'decrease' }]
        );

        const result = planWholeProjectVibeRun({
            context: { tracks: [contextTrack('t-kick', 'Kick', 'kick')] },
            descriptors: ['warm'],
            recipes: [unmeasurable, measurable],
            measurements: [],
        });

        expect(result.batches).toHaveLength(1);
        expect(result.batches[0]?.targets).toEqual([
            {
                targetId: 't-kick',
                recipeIds: ['warm-measurable'],
                expectedDeltas: [{ descriptor: 'warm', metric: 'spectralCentroid', band: null, direction: 'decrease' }],
                commandCount: 1,
            },
        ]);
    });

    it('lists on each target only the recipes that expand on it, and the deltas those recipes promise', () => {
        const ready = contextTrack('t-bus-ready', 'Group A', 'bus', {
            devices: [{ id: 'dev-comp', type: 'builtin-compressor', bypassed: false }],
        });
        const bare = contextTrack('t-bus-bare', 'Group B', 'bus');
        const context = projectContext([ready, bare]);

        const result = planWholeProjectVibeRun({
            context,
            descriptors: ['warm', 'punchy'],
            recipes: [catalogRecipe('bus-warm'), catalogRecipe('bus-punchy')],
            measurements: [],
        });

        const [batch] = result.batches;
        if (batch === undefined || result.batches.length !== 1) {
            throw new TypeError('Expected the two groups to share one batch.');
        }
        const readyTarget = batch.targets.find((target) => target.targetId === 't-bus-ready');
        const bareTarget = batch.targets.find((target) => target.targetId === 't-bus-bare');
        expect(readyTarget?.recipeIds).toEqual(['bus-warm', 'bus-punchy']);
        expect(readyTarget?.expectedDeltas.map((delta) => delta.descriptor)).toContain('punchy');
        expect(bareTarget?.recipeIds).toEqual(['bus-warm']);
        expect(bareTarget?.expectedDeltas.map((delta) => delta.descriptor)).toEqual(['warm', 'warm']);
        expect(batch.objective.descriptors).toEqual(['warm', 'punchy']);
        expect(expandBatch(batch, context)).toBe(batch.commandCount);
        expect(batch.commandCount).toBe(batch.targets.reduce((total, target) => total + target.commandCount, 0));
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

describe('planWholeProjectVibeRun recipe admission', () => {
    it('leaves out a track holding two live devices of the type a retune recipe would retune', () => {
        const compressor = { id: 'dev-comp-1', type: 'builtin-compressor', bypassed: false };
        const doubled = contextTrack('t-bus-doubled', 'Group', 'bus', {
            devices: [compressor, { ...compressor, id: 'dev-comp-2' }],
        });
        const context = projectContext([doubled]);

        const result = planWholeProjectVibeRun({
            context,
            descriptors: ['punchy'],
            recipes: [catalogRecipe('bus-punchy')],
            measurements: [],
        });

        expect(result.batches).toEqual([]);
        expect(result.excludedTargets).toEqual([{ targetId: 't-bus-doubled', reason: 'no-applicable-recipe' }]);
        const refusal = expandMixRecipe(
            { recipeId: 'bus-punchy', targetId: 't-bus-doubled', role: null, values: [] },
            context,
            0
        );
        expect(refusal.status).toBe('refused');
    });

    it('never lists a recipe whose own expansion passes what one expansion may add to a batch', () => {
        const oversizedParameterCount = RECIPE_EXPANSION_MAX_COMMANDS + 3;
        const oversized = synthetic(
            'warm-oversized',
            'warm',
            ['drums'],
            [{ metric: 'spectralCentroid', direction: 'decrease' }],
            oversizedParameterCount
        );
        expect(oversizedParameterCount + 1).toBeGreaterThan(RECIPE_EXPANSION_MAX_COMMANDS);
        expect(oversizedParameterCount + 1).toBeLessThanOrEqual(MAX_LLM_ACTIONS_PER_BATCH);
        const ordinary = synthetic(
            'warm-ordinary',
            'warm',
            ['drums'],
            [{ metric: 'spectralCentroid', direction: 'decrease' }]
        );

        const result = planWholeProjectVibeRun({
            context: { tracks: [contextTrack('t-kick', 'Kick', 'kick')] },
            descriptors: ['warm'],
            recipes: [oversized, ordinary],
            measurements: [],
        });

        const listed = result.batches.flatMap((batch) => batch.targets.flatMap((target) => target.recipeIds));
        expect(listed).toEqual(['warm-ordinary']);
    });

    it('limits each target baseline to the metrics that target own recipes expect', () => {
        const ready = contextTrack('t-bus-ready', 'Group A', 'bus', {
            devices: [{ id: 'dev-comp', type: 'builtin-compressor', bypassed: false }],
        });
        const bare = contextTrack('t-bus-bare', 'Group B', 'bus');
        const everyMetric = {
            frequencyBandEnergy: figure(1),
            spectralCentroid: figure(2),
            crestFactor: figure(3),
            transientDensity: figure(4),
        };

        const result = planWholeProjectVibeRun({
            context: { tracks: [ready, bare], sections: [SECTION_A] },
            descriptors: ['warm', 'punchy'],
            recipes: [catalogRecipe('bus-warm'), catalogRecipe('bus-punchy')],
            measurements: [
                measurement(window(0, 16, 's-a'), { 't-bus-ready': everyMetric, 't-bus-bare': everyMetric }),
            ],
        });

        const [batch] = result.batches;
        if (batch === undefined || result.batches.length !== 1) {
            throw new TypeError('Expected the two groups to share one batch.');
        }
        const metricsOf = (targetId: string) =>
            Object.keys(
                batch.baselines.find((baseline) => baseline.targetId === targetId)?.measurements ?? {}
            ).toSorted();
        expect(metricsOf('t-bus-ready')).toEqual([
            'crestFactor',
            'frequencyBandEnergy',
            'spectralCentroid',
            'transientDensity',
        ]);
        expect(metricsOf('t-bus-bare')).toEqual(['frequencyBandEnergy', 'spectralCentroid']);
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
