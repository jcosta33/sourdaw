import { describe, expect, it } from 'vitest';

import { type PerceptualConstraint, type PerceptualConstraintReading } from '../../models/PerceptualConstraint';
import { unionPerceptualConstraintReadings } from '../unionPerceptualConstraintReadings';

function loudness(
    clause: string,
    scope: PerceptualConstraint['scope'],
    constraintId: 'loudness-not-raised-v1' | 'loudness-held-v1' = 'loudness-not-raised-v1'
): PerceptualConstraint {
    return { constraintId, clause, scope, protection: { kind: 'measured' } };
}

function reading(...constraints: PerceptualConstraint[]): PerceptualConstraintReading {
    return { constraints, unsupported: [] };
}

describe('unionPerceptualConstraintReadings', () => {
    it('keeps the first clause of one protection over the same tracks named in another order', () => {
        const union = unionPerceptualConstraintReadings(
            reading(
                loudness("don't make the vocal and drums louder", { kind: 'tracks', trackIds: ['vocal', 'drums'] })
            ),
            reading(loudness("don't make the drums and vocal louder", { kind: 'tracks', trackIds: ['drums', 'vocal'] }))
        );
        expect(union.constraints).toEqual([
            loudness("don't make the vocal and drums louder", { kind: 'tracks', trackIds: ['vocal', 'drums'] }),
        ]);
    });

    it('keeps one protection over two scopes apart when one clause text states both', () => {
        const clause = "don't make it louder";
        const union = unionPerceptualConstraintReadings(
            reading(loudness(clause, { kind: 'tracks', trackIds: ['vocal', 'drums'] })),
            reading(loudness(clause, { kind: 'tracks', trackIds: ['vocal', 'bass'] }))
        );
        expect(union.constraints.map((constraint) => constraint.scope)).toEqual([
            { kind: 'tracks', trackIds: ['vocal', 'drums'] },
            { kind: 'tracks', trackIds: ['vocal', 'bass'] },
        ]);
    });

    it('keeps two protections over one scope apart', () => {
        const scope: PerceptualConstraint['scope'] = { kind: 'tracks', trackIds: ['vocal'] };
        const union = unionPerceptualConstraintReadings(
            reading(loudness('keep the vocal level', scope, 'loudness-held-v1')),
            reading(loudness("don't make the vocal louder", scope, 'loudness-not-raised-v1'))
        );
        expect(union.constraints.map((constraint) => constraint.constraintId)).toEqual([
            'loudness-held-v1',
            'loudness-not-raised-v1',
        ]);
    });

    it('keeps a mix-scoped and a track-scoped protection apart', () => {
        const union = unionPerceptualConstraintReadings(
            reading(loudness("don't make it louder", { kind: 'mix' })),
            reading(loudness("don't make the master louder", { kind: 'tracks', trackIds: ['master'] }))
        );
        expect(union.constraints.map((constraint) => constraint.scope.kind)).toEqual(['mix', 'tracks']);
    });
});
