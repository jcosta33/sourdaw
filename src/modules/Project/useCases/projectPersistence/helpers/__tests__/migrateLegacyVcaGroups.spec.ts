import { describe, expect, it } from 'vitest';

import { migrateLegacyVcaGroups } from '../migrateLegacyVcaGroups';

function trackCollection(collectionId: string, trackIds: string[], selectedTrackId: string | null = null) {
    return { collectionId, selectedTrackId, trackIds };
}

const rootCollection = trackCollection('root', ['track-drums', 'track-bass']);

type MigrationResult = ReturnType<typeof migrateLegacyVcaGroups>;
type ReadyMigration = Extract<MigrationResult, { status: 'ready' }>;

function requireReady(result: MigrationResult): ReadyMigration {
    if (result.status !== 'ready') {
        throw new Error('Expected a ready VCA migration plan');
    }
    return result;
}

describe('migrateLegacyVcaGroups', () => {
    it('should return an empty idempotent migration plan when no legacy groups exist', () => {
        const first = migrateLegacyVcaGroups({ legacyGroups: undefined, trackCollections: [rootCollection] });
        const second = migrateLegacyVcaGroups({ legacyGroups: [], trackCollections: [rootCollection] });

        expect(first).toEqual({
            status: 'ready',
            candidates: [],
            collections: [{ ...rootCollection, assignments: [], missingMembers: [] }],
        });
        expect(second).toEqual(first);
    });

    it('should preserve a populated legacy group as an inert VCA track candidate', () => {
        const legacyGroups = [
            {
                id: 'vca-drums',
                name: 'Drums VCA',
                gain: 0.75,
                muted: true,
                soloed: true,
                color: '#123456',
                trackIds: ['track-drums', 'track-bass'],
            },
        ];
        const originalInput = structuredClone(legacyGroups);

        const result = requireReady(migrateLegacyVcaGroups({ legacyGroups, trackCollections: [rootCollection] }));

        expect(result.candidates).toEqual([
            {
                id: 'vca-drums',
                legacyGroupId: 'vca-drums',
                kind: 'vca',
                order: 0,
                name: 'Drums VCA',
                color: '#123456',
                gain: 0.75,
                muted: true,
                soloed: true,
                memberTrackIds: ['track-drums', 'track-bass'],
                clips: [],
                devices: [],
                sends: [],
                midiFx: [],
                inputId: null,
                outputId: null,
                meterEnabled: false,
            },
        ]);
        expect(result.collections).toEqual([
            {
                ...rootCollection,
                assignments: [
                    { trackId: 'track-drums', vcaTrackId: 'vca-drums' },
                    { trackId: 'track-bass', vcaTrackId: 'vca-drums' },
                ],
                missingMembers: [],
            },
        ]);
        expect(legacyGroups).toEqual(originalInput);
    });

    it('should retain a deleted member as unresolved migration evidence without resurrecting it', () => {
        const result = requireReady(
            migrateLegacyVcaGroups({
                legacyGroups: [
                    {
                        id: 'vca-drums',
                        name: 'Drums',
                        gain: 1,
                        muted: false,
                        trackIds: ['track-drums', 'track-deleted'],
                    },
                ],
                trackCollections: [trackCollection('root', ['track-drums'], 'track-drums')],
            })
        );

        expect(result.candidates[0]?.memberTrackIds).toEqual(['track-drums', 'track-deleted']);
        expect(result.collections[0]?.assignments).toEqual([{ trackId: 'track-drums', vcaTrackId: 'vca-drums' }]);
        expect(result.collections[0]?.missingMembers).toEqual([
            { legacyGroupId: 'vca-drums', trackId: 'track-deleted' },
        ]);
        expect(result.collections[0]?.trackIds).toEqual(['track-drums']);
    });

    it('should reconcile track-side legacy membership and reject conflicting sources', () => {
        const legacyGroups = [
            { id: 'vca-drums', name: 'Drums', gain: 1, muted: false, trackIds: ['track-drums'] },
            { id: 'vca-bass', name: 'Bass', gain: 1, muted: false, trackIds: ['track-bass'] },
        ];
        const reconciled = requireReady(
            migrateLegacyVcaGroups({
                legacyGroups,
                trackCollections: [
                    {
                        ...trackCollection('root', ['track-drums', 'track-drums-copy', 'track-bass']),
                        legacyVcaGroupIdByTrackId: {
                            'track-drums': 'vca-drums',
                            'track-drums-copy': 'vca-drums',
                            'track-bass': null,
                        },
                    },
                ],
            })
        );
        const conflicting = migrateLegacyVcaGroups({
            legacyGroups,
            trackCollections: [
                {
                    ...rootCollection,
                    legacyVcaGroupIdByTrackId: { 'track-drums': 'vca-bass' },
                },
            ],
        });

        expect(reconciled.candidates[0]?.memberTrackIds).toEqual(['track-drums', 'track-drums-copy']);
        expect(reconciled.collections[0]?.assignments).toEqual([
            { trackId: 'track-drums', vcaTrackId: 'vca-drums' },
            { trackId: 'track-drums-copy', vcaTrackId: 'vca-drums' },
        ]);
        expect(conflicting).toEqual({
            status: 'invalid',
            errors: [
                {
                    code: 'ambiguous-membership',
                    groupIndex: 1,
                    collectionId: 'root',
                    field: 'legacyVcaGroupIdByTrackId',
                    value: 'track-drums',
                },
            ],
        });
    });

    it('should allocate one deterministic identity when a legacy group ID collides', () => {
        const input = {
            legacyGroups: [{ id: 'track-drums', name: 'Drums', gain: 1, muted: false, trackIds: ['track-bass'] }],
            trackCollections: [
                trackCollection('root', ['track-drums', 'track-drums-vca', 'track-bass']),
                trackCollection('alternate', ['track-drums-vca-2', 'track-bass'], 'track-bass'),
            ],
        };

        const first = requireReady(migrateLegacyVcaGroups(input));
        const second = migrateLegacyVcaGroups(input);

        expect(first).toEqual(second);
        expect(first.candidates[0]?.id).toBe('track-drums-vca-3');
        expect(first.collections.map((collection) => collection.assignments)).toEqual([
            [{ trackId: 'track-bass', vcaTrackId: 'track-drums-vca-3' }],
            [{ trackId: 'track-bass', vcaTrackId: 'track-drums-vca-3' }],
        ]);
    });

    it('should merge partial legacy input with existing candidates and remain idempotent', () => {
        const input = {
            legacyGroups: [
                { id: 'vca-drums', name: 'Drums', gain: 0.7, muted: false, trackIds: ['track-drums'] },
                { id: 'vca-bass', name: 'Bass', gain: 0.8, muted: true, trackIds: ['track-bass'] },
            ],
            trackCollections: [rootCollection],
        };
        const first = requireReady(migrateLegacyVcaGroups(input));

        const second = migrateLegacyVcaGroups({
            ...input,
            existingCandidates: first.candidates,
        });
        const partialLegacyInput = migrateLegacyVcaGroups({
            ...input,
            legacyGroups: [input.legacyGroups[1]],
            existingCandidates: first.candidates,
        });
        const withoutLegacyInput = migrateLegacyVcaGroups({
            ...input,
            legacyGroups: undefined,
            existingCandidates: first.candidates,
        });
        const reversedExistingCandidates = migrateLegacyVcaGroups({
            ...input,
            legacyGroups: undefined,
            existingCandidates: [...first.candidates].reverse(),
        });
        const mixedSubsetInput = migrateLegacyVcaGroups({
            ...input,
            legacyGroups: [input.legacyGroups[0]],
            existingCandidates: [first.candidates[1]!],
        });

        expect(second).toEqual(first);
        expect(partialLegacyInput).toEqual(first);
        expect(withoutLegacyInput).toEqual(first);
        expect(reversedExistingCandidates).toEqual(first);
        expect(mixedSubsetInput).toEqual(first);
    });

    it('should reject duplicate or invalid existing candidate orders', () => {
        const trackCollections = [trackCollection('root', ['track-a', 'track-b'])];
        const initial = requireReady(
            migrateLegacyVcaGroups({
                legacyGroups: [
                    { id: 'vca-a', name: 'A', gain: 1, muted: false, trackIds: ['track-a'] },
                    { id: 'vca-b', name: 'B', gain: 1, muted: false, trackIds: ['track-b'] },
                ],
                trackCollections,
            })
        );
        const firstCandidate = initial.candidates[0];
        const secondCandidate = initial.candidates[1];
        if (firstCandidate === undefined || secondCandidate === undefined) {
            throw new Error('Expected two dormant VCA candidates');
        }

        const duplicateOrder = migrateLegacyVcaGroups({
            legacyGroups: undefined,
            existingCandidates: [firstCandidate, { ...secondCandidate, order: firstCandidate.order }],
            trackCollections,
        });
        const invalidOrder = migrateLegacyVcaGroups({
            legacyGroups: undefined,
            existingCandidates: [{ ...firstCandidate, order: -1 }],
            trackCollections,
        });

        expect(duplicateOrder).toEqual({
            status: 'invalid',
            errors: [{ code: 'duplicate-candidate-order', groupIndex: 1, field: 'order', value: '0' }],
        });
        expect(invalidOrder).toEqual({
            status: 'invalid',
            errors: [{ code: 'invalid-candidate-order', groupIndex: 0, field: 'order', value: '-1' }],
        });
    });

    it('should deterministically repair existing candidate identity collisions', () => {
        const trackCollections = [trackCollection('root', ['track-a', 'track-b'])];
        const initial = requireReady(
            migrateLegacyVcaGroups({
                legacyGroups: [
                    { id: 'vca-a', name: 'A', gain: 1, muted: false, trackIds: ['track-a'] },
                    { id: 'vca-b', name: 'B', gain: 1, muted: false, trackIds: ['track-b'] },
                ],
                trackCollections,
            })
        );
        const trackCollision = requireReady(
            migrateLegacyVcaGroups({
                legacyGroups: undefined,
                existingCandidates: [{ ...initial.candidates[0]!, id: 'track-a' }, initial.candidates[1]!],
                trackCollections,
            })
        );
        const duplicateIds = requireReady(
            migrateLegacyVcaGroups({
                legacyGroups: undefined,
                existingCandidates: initial.candidates.map((candidate) => ({ ...candidate, id: 'shared-vca' })),
                trackCollections,
            })
        );

        expect(trackCollision.candidates.map((candidate) => candidate.id)).toEqual(['vca-a', 'vca-b']);
        expect(
            migrateLegacyVcaGroups({
                legacyGroups: undefined,
                existingCandidates: trackCollision.candidates,
                trackCollections,
            })
        ).toEqual(trackCollision);
        expect(duplicateIds.candidates.map((candidate) => candidate.id)).toEqual(['shared-vca', 'vca-b']);
        expect(duplicateIds.collections[0]?.assignments).toEqual([
            { trackId: 'track-a', vcaTrackId: 'shared-vca' },
            { trackId: 'track-b', vcaTrackId: 'vca-b' },
        ]);
        expect(
            migrateLegacyVcaGroups({
                legacyGroups: undefined,
                existingCandidates: duplicateIds.candidates,
                trackCollections,
            })
        ).toEqual(duplicateIds);
    });

    it('should preserve group, member, and saved collection order without changing selection', () => {
        const result = requireReady(
            migrateLegacyVcaGroups({
                legacyGroups: [
                    { id: 'vca-rhythm', name: 'Rhythm', gain: 0.8, muted: false, trackIds: ['track-bass'] },
                    { id: 'vca-drums', name: 'Drums', gain: 0.9, muted: true, trackIds: ['track-drums'] },
                ],
                trackCollections: [
                    trackCollection('root', ['track-drums', 'track-bass'], 'track-bass'),
                    trackCollection('snapshot-b', ['track-drums'], 'track-drums'),
                    trackCollection('snapshot-c', ['track-piano']),
                ],
            })
        );

        expect(result.candidates.map((candidate) => [candidate.id, candidate.order])).toEqual([
            ['vca-rhythm', 0],
            ['vca-drums', 1],
        ]);
        expect(result.collections[0]?.assignments).toEqual([
            { trackId: 'track-bass', vcaTrackId: 'vca-rhythm' },
            { trackId: 'track-drums', vcaTrackId: 'vca-drums' },
        ]);
        expect(
            result.collections.map(({ collectionId, selectedTrackId }) => ({ collectionId, selectedTrackId }))
        ).toEqual([
            { collectionId: 'root', selectedTrackId: 'track-bass' },
            { collectionId: 'snapshot-b', selectedTrackId: 'track-drums' },
            { collectionId: 'snapshot-c', selectedTrackId: null },
        ]);
        expect(result.collections[2]?.assignments).toEqual([]);
        expect(result.collections[2]?.missingMembers).toEqual([
            { legacyGroupId: 'vca-rhythm', trackId: 'track-bass' },
            { legacyGroupId: 'vca-drums', trackId: 'track-drums' },
        ]);
    });

    it('should reject malformed or ambiguous legacy groups without producing a partial plan', () => {
        const malformed = migrateLegacyVcaGroups({
            legacyGroups: [
                { id: 'vca-invalid', name: 'Invalid', gain: Number.POSITIVE_INFINITY, muted: false, trackIds: [] },
            ],
            trackCollections: [rootCollection],
        });
        const ambiguous = migrateLegacyVcaGroups({
            legacyGroups: [
                { id: 'vca-one', name: 'One', gain: 1, muted: false, trackIds: ['track-drums'] },
                { id: 'vca-two', name: 'Two', gain: 1, muted: false, trackIds: ['track-drums'] },
            ],
            trackCollections: [rootCollection],
        });

        expect(malformed).toEqual({
            status: 'invalid',
            errors: [{ code: 'invalid-gain', groupIndex: 0, field: 'gain' }],
        });
        expect(ambiguous).toEqual({
            status: 'invalid',
            errors: [{ code: 'ambiguous-membership', groupIndex: 1, field: 'trackIds', value: 'track-drums' }],
        });
    });
});
