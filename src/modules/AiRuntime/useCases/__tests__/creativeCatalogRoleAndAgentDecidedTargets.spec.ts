import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { getCanonicalTrackRole } from '#/modules/Project/useCases';

import { type CreativeInterpretationCatalog, type CreativeTargetCandidate } from '../../models/CreativeInterpretation';
import { type ProjectContext, type ProjectContextProductionBrief } from '../../models/ProjectContext';
import { admitPlanningInterpretation } from '../admitPlanningInterpretation';
import { resolveWorkflowTrackIds } from '../agentReference/resolveWorkflowTrackIds';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { prepareAnswerInterpretationCatalog } from '../prepareAnswerInterpretationCatalog';
import { prepareCreativeInterpretationCatalog } from '../prepareCreativeInterpretationCatalog';
import { prepareMetricIntentCatalog } from '../prepareMetricIntentCatalog';

registerDeviceEnginePorts();

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../..');
const REVISION = 'revision-creative-targets';

/**
 * The campaign fixture as production plans against it: `getProjectContext` derives every track's
 * canonical role through `getCanonicalTrackRole`, so the raw file's missing roles (Bass DI, Guitar,
 * Keys, the buses) are filled the same way here.
 */
function fixtureContext(): ProjectContext {
    const fixture = JSON.parse(
        readFileSync(resolve(REPOSITORY_ROOT, 'evidence/agent-campaign/corpora/fixture-project.json'), 'utf8')
    ) as ProjectContext;
    return {
        ...fixture,
        tracks: fixture.tracks.map((track) => ({
            ...track,
            canonicalRole: getCanonicalTrackRole({
                track: { id: track.id, name: track.name, kind: track.kind, clips: [], devices: [] },
            }),
        })),
    };
}

function prepare(prompt: string, context: ProjectContext = fixtureContext()): CreativeInterpretationCatalog {
    return prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: REVISION });
}

/** The fixture under a brief holding one locked decision on `trackId`. */
function withLockedDecision(context: ProjectContext, trackId: string): ProjectContext {
    const productionBrief: ProjectContextProductionBrief = {
        schemaVersion: 1,
        id: 'brief-creative-targets',
        revision: 1,
        vision: null,
        references: [],
        hardConstraints: [],
        preferences: [],
        sectionGoals: [],
        trackRoles: [],
        locks: [],
        decisions: [
            {
                id: 'decision-keep',
                scope: { kind: 'track', trackId },
                statement: 'Keep it as it is',
                rationale: null,
                status: 'locked',
                sourceRunId: null,
                relatedBatchId: null,
                supersededByDecisionId: null,
                createdAt: 0,
            },
        ],
        unresolvedQuestions: [],
        sourceRunLinks: [],
        supersedesBriefId: null,
        supersededByBriefId: null,
        createdAt: 0,
        updatedAt: 0,
    };
    return { ...context, productionBrief };
}

function slotParents(catalog: CreativeInterpretationCatalog, objectType: 'device' | 'clip' | 'notes'): string[] {
    return catalog.creationSlots
        .filter((slot) => slot.objectType === objectType)
        .flatMap((slot) => (slot.parentCandidateId === null ? [] : [slot.parentCandidateId]));
}

describe('creative catalog creation slots', () => {
    it('hangs a device and a clip slot under every published track target, the comparison subject included', () => {
        const catalog = prepare('make the guitar brighter than the hi-hat in the intro');

        const guitar = catalog.targets.find((target) => target.objectIds.includes('track-guitar'));
        const hiHat = catalog.targets.find((target) => target.objectIds.includes('track-hi-hat'));
        expect(guitar?.provenance).toBe('explicit-reference');
        expect(hiHat?.provenance).toBe('explicit-reference');
        for (const target of [guitar, hiHat]) {
            expect(slotParents(catalog, 'device')).toContain(target?.candidateId);
            expect(slotParents(catalog, 'clip')).toContain(target?.candidateId);
        }
        const ids = catalog.creationSlots.map((slot) => slot.candidateId);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

function targetIds(catalog: CreativeInterpretationCatalog): string[][] {
    return catalog.targets.map((target) => target.objectIds);
}

function provenances(catalog: CreativeInterpretationCatalog): string[] {
    return [...new Set(catalog.targets.map((target) => target.provenance))];
}

function targetFor(catalog: CreativeInterpretationCatalog, trackId: string): CreativeTargetCandidate {
    const target = catalog.targets.find((candidate) => candidate.objectIds.includes(trackId));
    if (target === undefined) {
        throw new Error(`Expected a published target for ${trackId}.`);
    }
    return target;
}

type MetricKind = 'literal' | 'non-acoustic' | 'perceptual' | 'comparative';

function metricIntentFor(kind: MetricKind | null, objectiveId: string) {
    if (kind === null) {
        return null;
    }
    const objectives = [];
    if (kind === 'perceptual' || kind === 'comparative') {
        objectives.push({
            objectiveId,
            scopeCandidateId: null,
            referenceScopeCandidateId: null,
            rangeCandidateId: null,
        });
    }
    return { kind, uncertainty: 'none', objectives };
}

/** One joint planning interpretation editing exactly `trackId`'s processing, with or without metric intent. */
function admitEdit(input: {
    prompt: string;
    trackId: string;
    kind: MetricKind | null;
    catalog?: CreativeInterpretationCatalog;
    context?: ProjectContext;
}) {
    const context = input.context ?? fixtureContext();
    const creative = input.catalog ?? prepare(input.prompt, context);
    const answer = prepareAnswerInterpretationCatalog({ prompt: input.prompt, context, projectRevision: REVISION });
    const metric = prepareMetricIntentCatalog({ prompt: input.prompt, answer });
    const unsupported = metric.objectives.find((objective) =>
        objective.goals.every((goal) => goal.source.kind === 'unsupported')
    );
    if (unsupported === undefined) {
        throw new Error('Expected the published unsupported objective.');
    }
    const metricIntent = metricIntentFor(input.kind, unsupported.id);
    return admitPlanningInterpretation({
        creative,
        answer,
        metric,
        projectRevision: REVISION,
        turn: 1,
        call: {
            id: 'joint-intake',
            name: 'selectCreativeInterpretation',
            arguments: {
                catalogId: creative.catalogId,
                modeId: 'edit',
                targetCandidateIds: [targetFor(creative, input.trackId).candidateId],
                editDimensionCandidateIds: creative.dimensions
                    .filter((entry) => entry.dimension === 'processing')
                    .map((entry) => entry.candidateId),
                constraintCandidateIds: [],
                creationSlotIds: [],
                uncertainty: 'none',
                answer: null,
                metricIntent,
            },
        },
    });
}

describe('creative catalog role-family targets', () => {
    it.each([
        { prompt: 'tighten up the drums', family: 'drums' as const },
        { prompt: 'the bass is too muddy in the chorus', family: 'bass' as const },
        { prompt: 'make the drums punchier', family: 'drums' as const },
        { prompt: 'drums need more punch', family: 'drums' as const },
        { prompt: 'the drums sound thin', family: 'drums' as const },
    ])('publishes "$prompt" as the $family family, one editable target per track', ({ prompt, family }) => {
        const context = fixtureContext();
        const catalog = prepare(prompt, context);
        const familyIds = resolveWorkflowTrackIds(context, 'expected-family', { all: [{ roleFamily: family }] });

        expect(familyIds.length).toBeGreaterThan(0);
        expect(catalog.modes).toContain('edit');
        expect(provenances(catalog)).toEqual(['role-reference']);
        expect(targetIds(catalog)).toEqual(familyIds.map((id) => [id]));
        for (const target of catalog.targets) {
            expect(slotParents(catalog, 'device')).toContain(target.candidateId);
        }
    });

    it.each([
        'add a drum machine',
        'add bus compression',
        'give it a bass boost',
        'build a vocal chain',
        'the drum sound',
    ])('publishes no role or agent-decided target for "%s", whose family word modifies another noun', (prompt) => {
        expect(prepare(prompt).targets).toEqual([]);
    });

    it.each(['add bus compression', 'add a drum machine'])(
        'keeps the selection as the edit target of "%s" rather than a family it only modifies',
        (prompt) => {
            const catalog = prepare(prompt, { ...fixtureContext(), selectedTrackId: 'track-snare' });

            expect(provenances(catalog)).toEqual(['contextual-selection']);
            expect(targetIds(catalog)).toEqual([['track-snare']]);
        }
    );

    it.each([
        { prompt: 'make the bass-heavy guitars brighter', family: 'guitar' as const },
        { prompt: 'make the drum-like vocals warmer', family: 'vocal' as const },
        { prompt: 'make the vocal-like drums punchier', family: 'drums' as const },
    ])(
        'publishes only the $family family for "$prompt", whose hyphenated compound names none',
        ({ prompt, family }) => {
            const context = fixtureContext();
            const familyIds = resolveWorkflowTrackIds(context, 'expected-family', { all: [{ roleFamily: family }] });

            expect(familyIds.length).toBeGreaterThan(0);
            expect(provenances(prepare(prompt, context))).toEqual(['role-reference']);
            expect(targetIds(prepare(prompt, context))).toEqual(familyIds.map((id) => [id]));
        }
    );

    it('publishes only the track the request names when it also names a family', () => {
        const catalog = prepare('make the kick punchier and tighten up the bass');

        expect(provenances(catalog)).toEqual(['explicit-reference']);
        expect(targetIds(catalog)).toEqual([['track-kick']]);
    });

    it('resolves the bass family to Bass DI under the roles production derives', () => {
        expect(targetIds(prepare('the bass is too muddy in the chorus'))).toEqual([['track-bass-di']]);
    });

    it('leaves a track the brief protects out of its role family, and keeps the rest of the family', () => {
        const context = withLockedDecision(fixtureContext(), 'track-kick');
        const catalog = prepare('tighten up the drums', context);

        expect(provenances(catalog)).toEqual(['role-reference']);
        expect(targetIds(catalog)).toEqual([['track-snare'], ['track-hi-hat'], ['track-overheads']]);
    });

    it('still publishes a brief-protected track the request names, so the brief refuses the edit itself', () => {
        const catalog = prepare('make the kick punchier', withLockedDecision(fixtureContext(), 'track-kick'));

        expect(provenances(catalog)).toEqual(['explicit-reference']);
        expect(targetIds(catalog)).toEqual([['track-kick']]);
    });

    it.each(['add a delay bus', 'add a new bass track'])(
        'publishes no role or agent-decided target for "%s", whose family word names the object it creates',
        (prompt) => {
            const catalog = prepare(prompt);

            expect(catalog.targets).toEqual([]);
            expect(catalog.modes).not.toContain('edit');
        }
    );

    it.each(['add a delay bus', 'add a new bass track'])('keeps the selection as the edit target of "%s"', (prompt) => {
        const context = { ...fixtureContext(), selectedTrackId: 'track-keys' };
        const catalog = prepare(prompt, context);

        expect(provenances(catalog)).toEqual(['contextual-selection']);
        expect(targetIds(catalog)).toEqual([['track-keys']]);
        const admission = admitEdit({ prompt, trackId: 'track-keys', kind: null, catalog, context });
        if (admission.status !== 'admitted' || admission.kind !== 'creative' || !('authority' in admission)) {
            throw new Error(`Expected the selected edit admitted: ${JSON.stringify(admission)}`);
        }
        expect(admission.authority.targets).toEqual([
            expect.objectContaining({ provenance: 'contextual-selection', objectIds: ['track-keys'] }),
        ]);
    });

    it('reads a role family inside a protection clause as kept out, never as a target', () => {
        const context = fixtureContext();
        const catalog = prepare('make it punchier but leave the drums alone', context);
        const drums = resolveWorkflowTrackIds(context, 'expected-drums', { all: [{ roleFamily: 'drums' }] });
        const offered = catalog.targets.flatMap((target) => target.objectIds);

        expect(provenances(catalog)).toEqual(['agent-decided']);
        expect(offered).toContain('track-bass-di');
        expect(offered.filter((id) => drums.includes(id))).toEqual([]);
    });
});

describe('creative catalog agent-decided targets', () => {
    it.each([
        { prompt: 'polish the low end', chosen: 'track-bass-di' },
        { prompt: 'make the chorus hit harder', chosen: 'track-kick' },
    ])('offers every plannable source for "$prompt" and admits a perceptual edit of $chosen', ({ prompt, chosen }) => {
        const catalog = prepare(prompt);

        expect(catalog.modes).toContain('edit');
        expect(provenances(catalog)).toEqual(['agent-decided']);
        expect(catalog.targets.every((target) => target.objectIds.length === 1)).toBe(true);
        expect(catalog.targets.flatMap((target) => target.objectIds)).toEqual(
            expect.arrayContaining(['track-bass-di', 'track-kick'])
        );
        expect(slotParents(catalog, 'device')).toContain(targetFor(catalog, chosen).candidateId);

        const admission = admitEdit({ prompt, trackId: chosen, kind: 'perceptual' });
        expect(admission).toMatchObject({ status: 'admitted', kind: 'creative' });
        if (admission.status !== 'admitted' || admission.kind !== 'creative' || !('authority' in admission)) {
            throw new Error('Expected admitted creative authority.');
        }
        expect(admission.authority.targets).toEqual([
            { provenance: 'agent-decided', objectType: 'track', objectIds: [chosen], parentTrackId: null },
        ]);
    });

    it('leaves out frozen, folder and protected tracks', () => {
        const base = withLockedDecision(fixtureContext(), 'track-lead-vocal');
        const context: ProjectContext = {
            ...base,
            tracks: base.tracks.map((track) => {
                if (track.id === 'track-guitar') {
                    return { ...track, frozen: true };
                }
                return track.id === 'track-backing-vocal-left' ? { ...track, kind: 'folder' } : track;
            }),
        };
        const catalog = prepare('polish the low end, leave Keys alone', context);
        const offered = catalog.targets.flatMap((target) => target.objectIds);

        expect(offered).toContain('track-bass-di');
        expect(offered).toContain('track-backing-vocal-right');
        expect(offered).not.toContain('track-guitar');
        expect(offered).not.toContain('track-backing-vocal-left');
        expect(offered).not.toContain('track-lead-vocal');
        expect(offered).not.toContain('track-keys');
        // Candidate ids number the offered tracks in order. A protected track dropped only after
        // numbering, by the shared protected-target filter, would leave a gap here.
        expect(catalog.targets.map((target) => target.candidateId)).toEqual(
            catalog.targets.map((_, index) => `target-${String(index + 1)}`)
        );
    });

    it.each([{ kind: 'literal' as const }, { kind: 'non-acoustic' as const }, { kind: null }])(
        'refuses an agent-decided edit under $kind metric intent',
        ({ kind }) => {
            const admission = admitEdit({ prompt: 'polish the low end', trackId: 'track-bass-di', kind });

            expect(admission).toEqual({ status: 'rejected', reason: expect.stringMatching(/agent-decided/u) });
        }
    );

    it.each(['make this track brighter', 'brighten the selected track'])(
        'publishes no target for "%s" when nothing is selected',
        (prompt) => {
            const catalog = prepare(prompt);

            expect(catalog.targets).toEqual([]);
            expect(catalog.modes).not.toContain('edit');
        }
    );

    it.each(['brighten the selected clip', 'make this clip warmer', 'warm up the selection'])(
        'publishes no agent-decided target for "%s" when nothing is selected',
        (prompt) => {
            const catalog = prepare(prompt);

            expect(catalog.targets).toEqual([]);
            expect(catalog.modes).not.toContain('edit');
        }
    );

    it('publishes no agent-decided candidate beside a named track or a selection', () => {
        const named = prepare('make the guitar brighter than the hi-hat in the intro');
        const selected = prepare('polish it', { ...fixtureContext(), selectedTrackId: 'track-keys' });

        expect(provenances(named)).toEqual(['explicit-reference']);
        expect(provenances(selected)).toEqual(['contextual-selection']);
        expect(targetIds(selected)).toEqual([['track-keys']]);
    });

    it('refuses an agent-decided target the catalog published beside a role reference', () => {
        const prompt = 'tighten up the drums';
        const roleCatalog = prepare(prompt);
        const catalog: CreativeInterpretationCatalog = {
            ...roleCatalog,
            targets: [
                ...roleCatalog.targets,
                {
                    candidateId: 'target-agent',
                    provenance: 'agent-decided',
                    objectType: 'track',
                    objectIds: ['track-guitar'],
                    parentTrackId: null,
                    label: 'Guitar',
                },
            ],
        };

        const admission = admitEdit({ prompt, trackId: 'track-guitar', kind: 'perceptual', catalog });
        expect(admission).toEqual({ status: 'rejected', reason: expect.stringMatching(/outrank/u) });
    });
});

describe('creative target rank', () => {
    it('refuses a role-reference target the catalog published beside an explicit reference', () => {
        const prompt = 'make the kick punchier';
        const explicitCatalog = prepare(prompt);
        expect(provenances(explicitCatalog)).toEqual(['explicit-reference']);
        const catalog: CreativeInterpretationCatalog = {
            ...explicitCatalog,
            targets: [
                ...explicitCatalog.targets,
                {
                    candidateId: 'target-role',
                    provenance: 'role-reference',
                    objectType: 'track',
                    objectIds: ['track-snare'],
                    parentTrackId: null,
                    label: 'Snare',
                },
            ],
        };

        const admission = admitEdit({ prompt, trackId: 'track-snare', kind: 'literal', catalog });
        expect(admission).toEqual({
            status: 'rejected',
            reason: expect.stringMatching(/^Explicit request references cannot be replaced/u),
        });
    });

    it('refuses a selected target the catalog published beside a role reference', () => {
        const prompt = 'tighten up the drums';
        const context = { ...fixtureContext(), selectedTrackId: 'track-keys' };
        const roleCatalog = prepare(prompt, context);
        expect(provenances(roleCatalog)).toEqual(['role-reference']);
        const catalog: CreativeInterpretationCatalog = {
            ...roleCatalog,
            targets: [
                ...roleCatalog.targets,
                {
                    candidateId: 'target-selected',
                    provenance: 'contextual-selection',
                    objectType: 'track',
                    objectIds: ['track-keys'],
                    parentTrackId: null,
                    label: 'Keys',
                },
            ],
        };

        const admission = admitEdit({ prompt, trackId: 'track-keys', kind: 'literal', catalog, context });
        expect(admission).toEqual({ status: 'rejected', reason: expect.stringMatching(/outrank/u) });
    });
});

type StoredKind = 'literal' | 'non-acoustic' | 'perceptual' | 'comparative';

/** A stored metric goal state whose one authority is an admitted perceptual edit of Bass DI, re-tagged. */
function storedAuthority(): (provenance: string, kind?: StoredKind) => string {
    const admission = admitEdit({ prompt: 'polish the low end', trackId: 'track-bass-di', kind: 'perceptual' });
    if (admission.status !== 'admitted' || !('metricAuthority' in admission)) {
        throw new Error('Expected admitted metric authority.');
    }
    const { metricAuthority } = admission;
    const { creativeAuthority } = metricAuthority;
    if (creativeAuthority === null) {
        throw new Error('Expected the metric authority to carry creative authority.');
    }
    return (provenance, kind = metricAuthority.kind) =>
        JSON.stringify({
            schemaVersion: 1,
            authorities: [
                {
                    ...metricAuthority,
                    kind,
                    goals: kind === 'literal' || kind === 'non-acoustic' ? [] : metricAuthority.goals,
                    creativeAuthority: {
                        ...creativeAuthority,
                        targets: creativeAuthority.targets.map((target) => ({ ...target, provenance })),
                    },
                },
            ],
            steps: [],
            proofs: [],
            binding: null,
        });
}

describe('persisted creative authority provenance', () => {
    it('decodes every provenance a stored authority may carry and refuses an unknown one', () => {
        const stored = storedAuthority();

        for (const provenance of [
            'explicit-reference',
            'contextual-selection',
            'new-object-slot',
            'role-reference',
            'agent-decided',
        ]) {
            expect(metricGoalStateCodec(stored(provenance))?.authorities[0]?.creativeAuthority?.targets).toEqual([
                expect.objectContaining({ provenance, objectIds: ['track-bass-di'] }),
            ]);
        }
        expect(metricGoalStateCodec(stored('invented'))).toBeNull();
    });

    it.each([{ kind: 'literal' as const }, { kind: 'non-acoustic' as const }])(
        'refuses a stored agent-decided target under $kind metric intent',
        ({ kind }) => {
            const stored = storedAuthority();

            expect(metricGoalStateCodec(stored('role-reference', kind))?.authorities[0]?.kind).toBe(kind);
            expect(metricGoalStateCodec(stored('agent-decided', kind))).toBeNull();
        }
    );
});
