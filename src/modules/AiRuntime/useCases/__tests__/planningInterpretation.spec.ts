import { describe, expect, it } from 'vitest';

import { getCanonicalTrackRole } from '#/modules/Project/useCases';

import { createCreativeInterpretationToolSchema } from '../../models/CreativeInterpretation';
import { projectOpenAiStrictToolSchema } from '../../repositories/cloudLlm/cloudInference/projectOpenAiStrictToolSchema';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { admitCreativeInterpretation } from '../admitCreativeInterpretation';
import { admitPlanningInterpretation } from '../admitPlanningInterpretation';
import { buildAgentContext } from '../buildAgentContext';
import {
    createPlanningCandidateView,
    createPlanningInterpretationToolSchema,
} from '../createPlanningInterpretationToolSchema';
import { getProjectContext } from '../getProjectContext';
import { prepareAnswerInterpretationCatalog } from '../prepareAnswerInterpretationCatalog';
import { prepareCreativeInterpretationCatalog } from '../prepareCreativeInterpretationCatalog';

import { createPlanningProject } from './planningProjectFixture';

function fixture(trackCount = 3) {
    const context = createPlanningProject(getProjectContext(), trackCount);
    // This context-minimization fixture has no separate brief references to section identities.
    if (context.productionBrief !== undefined) {
        context.productionBrief.sectionGoals = [];
    }
    const prompt = 'Describe the project';
    const creative = prepareCreativeInterpretationCatalog({ prompt, context, projectRevision: 'revision' });
    const answer = prepareAnswerInterpretationCatalog({ prompt, context, projectRevision: 'revision' });
    const built = buildAgentContext({ fixedPolicy: 'policy', prompt, context, projectRevision: 'revision' });
    const input = { creative, answer, binding: built.planningBinding };
    return { context, prompt, ...input, built, schema: createPlanningInterpretationToolSchema(input) };
}

function legacyCall(catalogId: string) {
    return {
        id: 'intake',
        name: 'selectCreativeInterpretation',
        arguments: {
            catalogId,
            modeId: 'read-only',
            targetCandidateIds: [],
            editDimensionCandidateIds: [],
            constraintCandidateIds: [],
            creationSlotIds: [],
            uncertainty: 'none',
        },
    };
}

describe('joint planning interpretation consumes the actual printed context view', () => {
    it.each([undefined, null])('delegates the exact original seven fields for answer=%j', (answer) => {
        const value = fixture();
        const original = legacyCall(value.creative.catalogId);
        const input = { creative: value.creative, answer: value.answer, projectRevision: 'revision' };
        const argumentsValue: Record<string, unknown> = { ...original.arguments };
        if (answer !== undefined) {
            argumentsValue.answer = answer;
        }
        const call = { ...original, arguments: argumentsValue };
        const expected = admitCreativeInterpretation({
            catalog: value.creative,
            call: original,
            projectRevision: 'revision',
        });
        const actual = admitPlanningInterpretation({ ...input, call });
        if (actual.status !== 'admitted' || actual.kind !== 'creative' || expected.status !== 'admitted') {
            throw new Error('Expected unchanged creative admission.');
        }
        // The unchanged producer mints a fresh authority identity for each separate admission.
        expect(actual.authority.authorityId).not.toBe(expected.authority.authorityId);
        expect(actual).toEqual({
            ...expected,
            kind: 'creative',
            authority: { ...expected.authority, authorityId: actual.authority.authorityId },
        });
        const originalSchema = createCreativeInterpretationToolSchema(value.creative);
        expect(value.schema.function.parameters.required).toEqual(originalSchema.function.parameters.required);
        for (const key of [
            'targetCandidateIds',
            'editDimensionCandidateIds',
            'constraintCandidateIds',
            'creationSlotIds',
        ]) {
            const { description: _description, ...originalProperty } = originalSchema.function.parameters.properties[
                key
            ] as Record<string, unknown>;
            expect(value.schema.function.parameters.properties[key]).toEqual(originalProperty);
        }
    });
    it('admits a separate read-only answer authority against the captured original answer catalog', () => {
        const value = fixture();
        const call = legacyCall(value.creative.catalogId);
        const args = {
            ...call.arguments,
            answer: {
                kind: 'project-facts',
                topicIds: [],
                scopeCandidateIds: [],
                rangeCandidateId: null,
                uncertainty: 'none',
            },
        };
        expect(matchesJsonSchema(args, value.schema.function.parameters)).toBe(true);
        expect(
            admitPlanningInterpretation({ ...value, call: { ...call, arguments: args }, projectRevision: 'revision' })
        ).toMatchObject({
            status: 'admitted',
            kind: 'answer',
            authority: { catalogId: value.answer.catalogId, kind: 'project-facts', revision: 'revision' },
        });
    });
    it.each(['invalid', [], 1, false, { catalogId: 'forged' }, { kind: 'project-facts' }])(
        'never falls back from malformed non-null answer %j',
        (answer) => {
            const value = fixture();
            const call = legacyCall(value.creative.catalogId);
            expect(
                admitPlanningInterpretation({
                    ...value,
                    call: { ...call, arguments: { ...call.arguments, answer } },
                    projectRevision: 'revision',
                }).status
            ).toBe('rejected');
        }
    );
    it('rejects mutation candidates and wrong mode beside a closed answer selection', () => {
        const value = fixture();
        const call = legacyCall(value.creative.catalogId);
        const answer = {
            kind: 'project-facts',
            topicIds: [],
            scopeCandidateIds: [],
            rangeCandidateId: null,
            uncertainty: 'none',
        };
        for (const patch of [
            { modeId: 'edit' },
            { targetCandidateIds: ['forged'] },
            { uncertainty: 'artistic' },
            { catalogId: 'stale' },
        ]) {
            expect(
                admitPlanningInterpretation({
                    ...value,
                    call: { ...call, arguments: { ...call.arguments, answer, ...patch } },
                    projectRevision: 'revision',
                }).status
            ).toBe('rejected');
        }
    });
    it.each([
        'full',
        'delta',
        'capped',
        'alternative',
        'truncated-name',
        'clip-set',
        'locked',
        'duplicate-names',
        'role-group',
        'mixed-kinds',
        'master-only',
    ] as const)('resolves complete scope rows and range facts from the exact %s outbound payload', (mode) => {
        const value = fixture(mode === 'capped' ? 65 : 3);
        if (mode === 'alternative') {
            value.context.tracks[0]!.alternativeClipIds = ['alternative-clip'];
        }
        if (mode === 'truncated-name') {
            value.context.tracks[0]!.name = 'Long imported label '.repeat(80);
        }
        if (mode === 'clip-set') {
            value.context.selectedClipIds = [
                value.context.tracks[0]!.clips[0]!.id,
                value.context.tracks[1]!.clips[0]!.id,
            ];
        }
        if (mode === 'locked') {
            const clip = value.context.tracks[0]!.clips[0]!;
            clip.locked = true;
            value.context.productionBrief!.locks.push({
                id: 'locked-clip',
                scope: { kind: 'object', objectId: clip.id },
                statement: 'Preserve this clip.',
                createdAt: 0,
            });
        }
        if (mode === 'duplicate-names') {
            value.context.tracks[0]!.name = 'Vocal';
            value.context.tracks[1]!.name = 'Vocal';
            value.context.sections = [
                { id: 'private-section-a', name: 'Chorus', startBeat: 4, endBeat: 8 },
                { id: 'private-section-b', name: 'Chorus', startBeat: 4, endBeat: 8 },
            ];
        }
        if (mode === 'role-group') {
            value.context.tracks[0]!.name = 'Lead Vocal';
            value.context.tracks[1]!.name = 'Lead Vocal';
            value.context.tracks = value.context.tracks.map((track) => ({
                ...track,
                canonicalRole: getCanonicalTrackRole({
                    track: { id: track.id, name: track.name, kind: track.kind, clips: [], devices: [] },
                }),
            }));
        }
        if (mode === 'mixed-kinds') {
            value.context.tracks[1]!.kind = 'bus';
            value.context.tracks[1]!.name = 'Vocal Bus';
            value.context.tracks[1]!.clips = [];
            value.context.tracks[2]!.kind = 'master';
            value.context.tracks[2]!.clips = [];
        }
        if (mode === 'master-only') {
            value.context.tracks = [
                { ...value.context.tracks[0]!, id: 'master', name: 'Master', kind: 'master', clips: [] },
            ];
            value.context.selectedTrackId = null;
            value.context.selectedClipId = null;
            value.context.selectedClipIds = [];
            value.context.productionBrief!.locks = [];
        }
        const priorEvidence = mode === 'delta' ? value.built.evidence : undefined;
        const revision = mode === 'delta' ? 'revision-next' : 'revision';
        const built = buildAgentContext({
            fixedPolicy: 'policy',
            prompt: value.prompt,
            context: value.context,
            projectRevision: revision,
            priorEvidence,
        });
        const creative = prepareCreativeInterpretationCatalog({
            prompt: value.prompt,
            context: value.context,
            projectRevision: revision,
        });
        const answer = prepareAnswerInterpretationCatalog({
            prompt: value.prompt,
            context: value.context,
            projectRevision: revision,
        });
        const view = createPlanningCandidateView(creative, answer, built.planningBinding);
        if (mode === 'clip-set') {
            expect(
                creative.targets.some((target) => target.objectType === 'clip-set' && target.objectIds.length === 2)
            ).toBe(true);
        }
        if (mode === 'locked') {
            expect(creative.constraints).toContainEqual(
                expect.objectContaining({ kind: 'protect-object', objectId: value.context.tracks[0]!.clips[0]!.id })
            );
        }
        if (mode === 'role-group') {
            expect(
                answer.scopes.some((scope) => scope.candidateId.startsWith('role:') && scope.objectIds.length === 3)
            ).toBe(true);
        }
        if (mode === 'mixed-kinds') {
            expect(answer.scopes.map((scope) => scope.kind)).toEqual(
                expect.arrayContaining(['tracks', 'buses', 'master'])
            );
        }
        if (mode === 'master-only') {
            expect(answer.scopes).toEqual([
                { candidateId: 'master', kind: 'master', objectIds: ['master'], labels: ['Master output'] },
            ]);
        }

        const printed = JSON.parse(built.localMessage.split('untrusted_project_data:\n')[1]!.split('\n')[0]!).data as {
            selectableTargets?: Array<{
                id: string;
                name: { value: string };
                clips: Array<{ id: string; name: { value: string } }>;
            }>;
            sections?: Array<{ name: { value: string }; startBeat: number; endBeat: number }>;
        };
        // Resolve addresses from actual outbound bytes, independently of the app-only binding.
        const byReference = new Map<string, { id: string; label: string }>();
        for (const [trackIndex, track] of (printed.selectableTargets ?? []).entries()) {
            byReference.set(`t${String(trackIndex)}`, { id: track.id, label: track.name.value });
            for (const [clipIndex, clip] of track.clips.entries()) {
                byReference.set(`c${String(trackIndex)}.${String(clipIndex)}`, {
                    id: clip.id,
                    label: clip.name.value,
                });
            }
        }
        for (const [index, row] of view.fallback.entries()) {
            byReference.set(`f${String(index)}`, { id: row[1], label: row[2] });
        }
        byReference.set('master', { id: 'master', label: 'Master output' });
        const resolved = view.scopes.map((row) => {
            const [kind, references, overrides] = row as [string, string[], string[] | undefined];
            return {
                kind,
                objectIds: references.map((reference) => byReference.get(reference)!.id),
                labels: overrides ?? references.map((reference) => byReference.get(reference)!.label),
            };
        });
        expect(resolved).toEqual(answer.scopes.map(({ candidateId: _candidateId, ...scope }) => scope));
        expect(
            view.ranges.map((row) => {
                if (typeof row !== 'string') {
                    return { label: row[0], startBeat: row[1], endBeat: row[2] };
                }
                const section = printed.sections?.[Number(row.slice(1))];
                if (section === undefined) {
                    return null;
                }
                return { label: section.name.value, startBeat: section.startBeat, endBeat: section.endBeat };
            })
        ).toEqual(
            answer.ranges.map((range) => ({
                label: range.label,
                startBeat: range.startBeat,
                endBeat: range.endBeat,
            }))
        );
        expect(
            view.targets.map((row) => {
                const [provenance, objectType, references, parent, label] = row as [
                    string,
                    string,
                    string[],
                    string | null,
                    string,
                ];
                return {
                    provenance,
                    objectType,
                    objectIds: references.map((ref) => byReference.get(ref)!.id),
                    parentTrackId: parent === null ? null : byReference.get(parent)!.id,
                    label,
                };
            })
        ).toEqual(creative.targets.map(({ candidateId: _id, ...target }) => target));
        expect(view.dimensions).toEqual(creative.dimensions.map((entry) => entry.dimension));
        expect(view.slots).toEqual(
            creative.creationSlots.map((entry) => [entry.objectType, entry.parentCandidateId, entry.budget])
        );
        expect(
            view.constraints.map((row) =>
                row[0] === 'exclude-dimension' ? row : [row[0], byReference.get(String(row[1]))!.id, row[2]]
            )
        ).toEqual(
            creative.constraints.map((entry) => {
                if (entry.kind === 'exclude-dimension') {
                    return [entry.kind, entry.dimension];
                }
                return [entry.kind, entry.objectId, entry.label];
            })
        );
        expect(view.activeView).toBe(creative.selection.activeView);
        expect(view.unresolved).toEqual(creative.unresolvedExplicitReferences);
        const schema = createPlanningInterpretationToolSchema({ creative, answer, binding: built.planningBinding });
        for (const section of answer.context.sections ?? []) {
            expect(schema.function.description).not.toContain(section.id);
            expect(built.message).not.toContain(section.id);
            expect(built.localMessage).not.toContain(section.id);
        }
        if (mode === 'delta') {
            expect(built.planningBinding.mode).toBe('delta');
            expect(built.planningBinding.objects).toEqual([]);
            expect(view.fallback.length).toBeGreaterThan(0);
        }
    });
    it('rejects a stale binding or mismatched selection before a candidate view is disclosed', () => {
        const value = fixture();
        expect(() =>
            createPlanningInterpretationToolSchema({ ...value, binding: { ...value.binding, revision: 'stale' } })
        ).toThrow('do not share');
        expect(() =>
            createPlanningInterpretationToolSchema({
                ...value,
                binding: { ...value.binding, selection: { ...value.binding.selection, trackId: 'forged' } },
            })
        ).toThrow('do not share');
    });
    it('adds read-only only to the answer branch when the original quoted-reference catalog is unresolved', () => {
        const value = fixture();
        const prompt = 'Describe "Missing track"';
        const creative = prepareCreativeInterpretationCatalog({
            prompt,
            context: value.context,
            projectRevision: 'revision',
        });
        const answer = prepareAnswerInterpretationCatalog({
            prompt,
            context: value.context,
            projectRevision: 'revision',
        });
        const binding = buildAgentContext({
            fixedPolicy: 'policy',
            prompt,
            context: value.context,
            projectRevision: 'revision',
        }).planningBinding;
        expect(creative.modes).toEqual(['unresolved']);
        const schema = createPlanningInterpretationToolSchema({ creative, answer, binding });
        const call = legacyCall(creative.catalogId);
        expect(admitPlanningInterpretation({ creative, answer, call, projectRevision: 'revision' }).status).toBe(
            'rejected'
        );
        const argumentsValue = {
            ...call.arguments,
            answer: {
                kind: 'project-facts',
                topicIds: [],
                scopeCandidateIds: [],
                rangeCandidateId: null,
                uncertainty: 'none',
            },
        };
        expect(matchesJsonSchema(argumentsValue, schema.function.parameters)).toBe(true);
        expect(
            admitPlanningInterpretation({
                creative,
                answer,
                call: { ...call, arguments: argumentsValue },
                projectRevision: 'revision',
            })
        ).toMatchObject({ status: 'admitted', kind: 'answer' });
    });
    it('retains the declared strict-hosted nullable answer while delegating only seven legacy arguments', () => {
        const value = fixture();
        const strict = projectOpenAiStrictToolSchema(value.schema);
        expect(strict.function.parameters.required).toContain('answer');
        const call = legacyCall(value.creative.catalogId);
        expect(matchesJsonSchema({ ...call.arguments, answer: null }, strict.function.parameters)).toBe(true);
        expect(
            admitPlanningInterpretation({
                ...value,
                call: { ...call, arguments: { ...call.arguments, answer: null } },
                projectRevision: 'revision',
            })
        ).toMatchObject({ status: 'admitted', kind: 'creative', authority: { mode: 'read-only' } });
    });
    it('does not disclose fallback data when the actual context producer denies incomplete authority', () => {
        const value = fixture();
        const trackId = value.context.selectedTrackId!;
        value.context.productionBrief!.locks = Array.from({ length: 65 }, (_, index) => ({
            id: `lock-${String(index)}`,
            scope: { kind: 'track' as const, trackId },
            statement: 'Withheld policy authority',
            createdAt: index,
        }));
        const built = buildAgentContext({
            fixedPolicy: 'policy',
            prompt: value.prompt,
            context: value.context,
            projectRevision: 'revision',
        });
        expect(built.authorityComplete).toBe(false);
        const creative = prepareCreativeInterpretationCatalog({
            prompt: value.prompt,
            context: value.context,
            projectRevision: 'revision',
        });
        const answer = prepareAnswerInterpretationCatalog({
            prompt: value.prompt,
            context: value.context,
            projectRevision: 'revision',
        });
        expect(() =>
            createPlanningInterpretationToolSchema({ creative, answer, binding: built.planningBinding })
        ).toThrow('Incomplete production authority cannot be disclosed');
    });
    it('does not expose removed internal section identities on the second real context request', () => {
        const value = fixture();
        const removedId = value.context.sections![0]!.id;
        const next = buildAgentContext({
            fixedPolicy: 'policy',
            prompt: value.prompt,
            context: { ...value.context, sections: value.context.sections!.slice(1) },
            projectRevision: 'next',
            priorEvidence: value.built.evidence,
        });
        expect(next.message).not.toContain(removedId);
        expect(next.localMessage).not.toContain(removedId);
        expect(next.evidence.delta.mode).toBe('full');
    });
});
