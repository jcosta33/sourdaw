import { describe, expect, it } from 'vitest';

import { createDefaultProductionBrief, isProductionBrief, type ProductionBrief } from '../../models/ProductionBrief';
import { composeProductionBriefUpdate } from '../composeProductionBriefUpdate';

function briefWithIntent(): ProductionBrief {
    return {
        ...createDefaultProductionBrief(100),
        revision: 3,
        updatedAt: 200,
        vision: 'Warm and roomy',
        hardConstraints: [{ id: 'held', scope: { kind: 'project' }, statement: 'Keep the room sound', createdAt: 150 }],
        trackRoles: [{ id: 'authored', trackId: 'vocal', role: 'lead vocal', createdAt: 150 }],
        locks: [{ id: 'lock-drums', scope: { kind: 'track', trackId: 'drums' }, statement: 'Drums', createdAt: 150 }],
        decisions: [
            {
                id: 'decision-a',
                scope: { kind: 'project' },
                statement: 'Mono bass',
                rationale: null,
                status: 'accepted',
                sourceRunId: null,
                relatedBatchId: null,
                supersededByDecisionId: null,
                createdAt: 150,
            },
        ],
    };
}

function compose(update: Parameters<typeof composeProductionBriefUpdate>[0]['update'], brief = briefWithIntent()) {
    let next = 0;
    return composeProductionBriefUpdate({
        brief,
        update,
        trackIds: ['vocal', 'drums', 'keys'],
        sectionIds: ['chorus'],
        sourceRunId: 'run-1',
        now: 500,
        createId: (prefix) => `${prefix}-${String((next += 1))}`,
    });
}

function composed(result: ReturnType<typeof composeProductionBriefUpdate>): ProductionBrief {
    if (result.status !== 'composed') {
        throw new Error(`expected a composed brief, got ${result.field}: ${result.reason}`);
    }
    return result.brief;
}

describe('compose a production brief update', () => {
    it('adds the requested entries at the next revision with application-minted ids and times', () => {
        const brief = composed(
            compose({
                vision: '  Late-night   lo-fi record ',
                preferences: [{ scope: { kind: 'project' }, statement: 'Dusty, soft transients' }],
                hardConstraints: [{ scope: { kind: 'track', trackId: 'vocal' }, statement: 'Keep the vocal intimate' }],
                sectionGoals: [{ sectionId: 'chorus', statement: 'Lift a little' }],
                trackRoles: [{ trackId: 'keys', role: 'keys' }],
                references: [{ label: 'Rainy tape demo' }],
            })
        );

        expect(isProductionBrief(brief)).toBe(true);
        expect(brief.revision).toBe(4);
        expect(brief.updatedAt).toBe(500);
        expect(brief.vision).toBe('Late-night lo-fi record');
        expect(brief.preferences).toEqual([
            { id: 'preference-3', scope: { kind: 'project' }, statement: 'Dusty, soft transients', createdAt: 500 },
        ]);
        expect(brief.hardConstraints.at(-1)).toEqual({
            id: 'constraint-2',
            scope: { kind: 'track', trackId: 'vocal' },
            statement: 'Keep the vocal intimate',
            createdAt: 500,
        });
        expect(brief.sectionGoals).toEqual([
            { id: 'section-goal-4', sectionId: 'chorus', statement: 'Lift a little', createdAt: 500 },
        ]);
        expect(brief.trackRoles.at(-1)).toEqual({ id: 'role-5', trackId: 'keys', role: 'keys', createdAt: 500 });
        expect(brief.references).toEqual([
            { id: 'reference-1', label: 'Rainy tape demo', uri: null, assetHash: null, createdAt: 500 },
        ]);
        expect(brief.sourceRunLinks).toEqual([{ id: 'source-run-link-6', sourceRunId: 'run-1', createdAt: 500 }]);
    });

    it('copies locks and decisions byte for byte', () => {
        const before = briefWithIntent();
        const brief = composed(compose({ vision: 'Late-night lo-fi record' }, before));

        expect(JSON.stringify(brief.locks)).toBe(JSON.stringify(before.locks));
        expect(JSON.stringify(brief.decisions)).toBe(JSON.stringify(before.decisions));
        expect(JSON.stringify(brief.unresolvedQuestions)).toBe(JSON.stringify(before.unresolvedQuestions));
    });

    it('never moves updatedAt behind the brief it replaces', () => {
        const before = { ...briefWithIntent(), updatedAt: 900 };
        const brief = composed(compose({ vision: 'Late-night lo-fi record' }, before));

        expect(brief.updatedAt).toBe(900);
    });

    it('folds a statement the brief already holds instead of repeating it', () => {
        const brief = composed(
            compose({
                vision: 'Late-night lo-fi record',
                hardConstraints: [
                    { scope: { kind: 'project' }, statement: 'keep the  ROOM sound' },
                    { scope: { kind: 'track', trackId: 'vocal' }, statement: 'Keep the room sound' },
                ],
            })
        );

        expect(brief.hardConstraints.map((entry) => entry.scope)).toEqual([
            { kind: 'project' },
            { kind: 'track', trackId: 'vocal' },
        ]);
    });

    it('treats a role the track already holds as no change, and refuses replacing it', () => {
        expect(compose({ trackRoles: [{ trackId: 'vocal', role: 'lead vocal' }] })).toEqual({
            status: 'refused',
            field: 'update',
            reason: 'The requested change leaves the production brief as it is.',
        });
        expect(compose({ trackRoles: [{ trackId: 'vocal', role: 'backing vocal' }] })).toMatchObject({
            status: 'refused',
            field: 'trackRoles',
        });
    });

    it.each([
        ['an unknown track', { trackRoles: [{ trackId: 'ghost', role: 'keys' }] }, 'trackRoles'],
        ['a non-canonical role', { trackRoles: [{ trackId: 'keys', role: 'vibe master' }] }, 'trackRoles'],
        ['the unknown role', { trackRoles: [{ trackId: 'keys', role: 'unknown' }] }, 'trackRoles'],
        [
            'one track twice',
            {
                trackRoles: [
                    { trackId: 'keys', role: 'keys' },
                    { trackId: 'keys', role: 'synth' },
                ],
            },
            'trackRoles',
        ],
        ['an unknown section goal', { sectionGoals: [{ sectionId: 'bridge', statement: 'Drop out' }] }, 'sectionGoals'],
        [
            'an unknown track scope',
            { preferences: [{ scope: { kind: 'track', trackId: 'ghost' }, statement: 'Softer' }] },
            'preferences',
        ],
        [
            'an unknown section scope',
            { hardConstraints: [{ scope: { kind: 'section', sectionId: 'bridge' }, statement: 'Quiet' }] },
            'hardConstraints',
        ],
        ['a link', { references: [{ label: 'https://example.com/track' }] }, 'references'],
        ['a bare address', { vision: 'like www.example.com' }, 'vision'],
        ['an empty statement', { preferences: [{ scope: { kind: 'project' }, statement: ' \n ' }] }, 'preferences'],
        ['an oversize vision', { vision: 'a'.repeat(513) }, 'vision'],
        [
            'an oversize statement',
            { preferences: [{ scope: { kind: 'project' }, statement: 'a'.repeat(281) }] },
            'preferences',
        ],
        ['an oversize label', { references: [{ label: 'a'.repeat(121) }] }, 'references'],
        [
            'too many entries at once',
            {
                preferences: Array.from({ length: 9 }, (_, index) => ({
                    scope: { kind: 'project' as const },
                    statement: `Preference ${String(index)}`,
                })),
            },
            'preferences',
        ],
    ] as const)('refuses %s and names the field', (_label, update, field) => {
        expect(compose(update)).toMatchObject({ status: 'refused', field });
    });

    it('refuses a brief past its per-field cap', () => {
        const full: ProductionBrief = {
            ...briefWithIntent(),
            preferences: Array.from({ length: 32 }, (_, index) => ({
                id: `held-${String(index)}`,
                scope: { kind: 'project' as const },
                statement: `Held ${String(index)}`,
                createdAt: 150,
            })),
        };

        expect(compose({ preferences: [{ scope: { kind: 'project' }, statement: 'One more' }] }, full)).toMatchObject({
            status: 'refused',
            field: 'preferences',
        });
    });

    it('strips control characters before it compares or stores text', () => {
        const brief = composed(compose({ vision: 'Late\u0007night\u0000 record' }));

        expect(brief.vision).toBe('Late night record');
    });
});
