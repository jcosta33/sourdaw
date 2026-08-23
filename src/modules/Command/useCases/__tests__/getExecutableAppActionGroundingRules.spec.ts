import { describe, expect, it } from 'vitest';

import { executableAppActionDescriptorByType } from '../executableAppActionRegistry';
import { getExecutableAppActionGroundingRules } from '../getExecutableAppActionGroundingRules';

const HANDLER_SEMANTIC_MUTATION_IDENTITIES = [
    {
        semantic: 'independent child creation',
        actionType: 'addClip',
        expected: [],
    },
    {
        semantic: 'singleton project resource',
        actionType: 'setTempo',
        expected: [{ arguments: [] }],
    },
    {
        semantic: 'existing member reference',
        actionType: 'setMarkerColor',
        expected: [{ arguments: [{ argument: 'beat' }, { argument: 'name' }] }],
    },
    {
        semantic: 'mutated subject instead of destination',
        actionType: 'moveClip',
        expected: [{ arguments: [{ argument: 'clipId' }] }],
    },
    {
        semantic: 'composite uniqueness',
        actionType: 'addAutomationLane',
        expected: [{ arguments: [{ argument: 'trackId' }, { argument: 'parameterId' }] }],
    },
    {
        semantic: 'materialized routing endpoint',
        actionType: 'addSidechainRoute',
        expected: [{ arguments: [{ argument: 'sourceTrackId' }, { argument: 'targetDeviceId' }] }],
    },
    {
        semantic: 'many-member expansion',
        actionType: 'automateTrackGainRange',
        expected: [{ arguments: [{ argument: 'trackIds', cardinality: 'many' }] }],
    },
    {
        semantic: 'independent point creation',
        actionType: 'addAutomationPoint',
        expected: [],
    },
] as const;

function assertHandlerSemanticMutationIdentities(
    actual: ReadonlyMap<string, readonly { arguments: readonly { argument: string; cardinality?: 'many' }[] }[]>
): void {
    for (const { actionType, expected } of HANDLER_SEMANTIC_MUTATION_IDENTITIES) {
        if (JSON.stringify(actual.get(actionType)) !== JSON.stringify(expected)) {
            throw new Error(`Handler-semantic mutation identity mismatch: ${actionType}`);
        }
    }
}

describe('getExecutableAppActionGroundingRules', () => {
    it('returns null for an unknown action type', () => {
        const result = getExecutableAppActionGroundingRules('nonexistent-action');

        expect(result).toBeNull();
    });

    it('returns the action type, intent phrases, and target rules for a known action', () => {
        const result = getExecutableAppActionGroundingRules('addTrack');

        expect(result).not.toBeNull();
        expect(result?.actionType).toBe('addTrack');
        expect(result?.intentPhrases.length).toBeGreaterThan(0);
        expect(result?.intentPhrases).toContain('add track');
        expect(result?.targetRules).toEqual([]);
        expect(result?.mutationIdentityRules).toEqual([]);
    });

    it('owns mutation identity independently from capability targets', () => {
        expect(getExecutableAppActionGroundingRules('setTrackOutput')).toMatchObject({
            targetRules: [
                { argument: 'outputId', capability: 'output' },
                { argument: 'trackId', capability: 'routable-source' },
            ],
            mutationIdentityRules: [{ arguments: [{ argument: 'trackId' }] }],
        });
        expect(getExecutableAppActionGroundingRules('setDeviceParameter')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'deviceId' }, { argument: 'paramId' }] },
        ]);
        expect(getExecutableAppActionGroundingRules('automateTrackGainRange')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'trackIds', cardinality: 'many' }] },
        ]);
        expect(getExecutableAppActionGroundingRules('addSend')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'trackId' }, { argument: 'busId' }] },
        ]);
        expect(getExecutableAppActionGroundingRules('moveClip')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'clipId' }] },
        ]);
        expect(getExecutableAppActionGroundingRules('copyMidiArticulations')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'targetClipId' }] },
        ]);
        expect(getExecutableAppActionGroundingRules('assignToVca')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'trackId' }] },
        ]);
        expect(getExecutableAppActionGroundingRules('addDevice')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'trackId' }] },
        ]);
    });

    it.each(HANDLER_SEMANTIC_MUTATION_IDENTITIES)(
        'matches handler semantics for $semantic',
        ({ actionType, expected }) => {
            expect(getExecutableAppActionGroundingRules(actionType)?.mutationIdentityRules).toEqual(expected);
        }
    );

    it.each([
        ['setTempo', []],
        ['addClip', [{ arguments: [{ argument: 'trackId' }] }]],
        ['addAutomationLane', [{ arguments: [{ argument: 'trackId' }] }]],
        ['automateTrackGainRange', [{ arguments: [{ argument: 'trackIds' }] }]],
    ] as const)('rejects the handler-semantic mutation mutant for %s', (actionType, mutation) => {
        const actual = new Map(
            HANDLER_SEMANTIC_MUTATION_IDENTITIES.map(({ actionType: expectedActionType }) => {
                const grounding = getExecutableAppActionGroundingRules(expectedActionType);
                if (grounding === null) {
                    throw new Error(`Missing executable grounding rules: ${expectedActionType}`);
                }
                return [expectedActionType, grounding.mutationIdentityRules] as const;
            })
        );
        actual.set(actionType, mutation);

        expect(() => assertHandlerSemanticMutationIdentities(actual)).toThrow(
            `Handler-semantic mutation identity mismatch: ${actionType}`
        );
    });

    it('includes valueRules when the descriptor defines them', () => {
        const result = getExecutableAppActionGroundingRules('addTrack');

        expect(result).not.toBeNull();
        expect(result?.valueRules.length).toBeGreaterThan(0);
    });

    it('defaults valueRules to an empty array when the descriptor omits them', () => {
        // Find an action without valueRules.
        const actionWithoutValueRules = [...executableAppActionDescriptorByType.entries()].find(
            ([, descriptor]) => !('valueRules' in descriptor)
        )?.[0];

        if (!actionWithoutValueRules) {
            // All actions happen to have valueRules — skip this test.
            return;
        }

        const result = getExecutableAppActionGroundingRules(actionWithoutValueRules);

        expect(result?.valueRules).toEqual([]);
    });

    it('includes directionalIntent when the descriptor defines it', () => {
        const result = getExecutableAppActionGroundingRules('bypassDevice');

        expect(result).not.toBeNull();
        expect(result?.directionalIntent).toBeDefined();
    });

    it('omits directionalIntent (undefined) when the descriptor does not define it', () => {
        const result = getExecutableAppActionGroundingRules('addTrack');

        expect(result).not.toBeNull();
        expect(result?.directionalIntent).toBeUndefined();
    });

    it('returns a deep clone (structuredClone), not the descriptor itself', () => {
        const result = getExecutableAppActionGroundingRules('addTrack');
        const descriptor = executableAppActionDescriptorByType.get('addTrack')!;

        // The intentPhrases array must not be the same reference as the descriptor's.
        expect(result?.intentPhrases).not.toBe(descriptor.intentPhrases);
        expect(result?.mutationIdentityRules).not.toBe(
            getExecutableAppActionGroundingRules('addTrack')?.mutationIdentityRules
        );
        // But the contents must match.
        expect(result?.intentPhrases).toEqual(descriptor.intentPhrases);
    });
});
