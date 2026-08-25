import { describe, expect, it } from 'vitest';

import { executableAppActionDescriptorByType } from '../executableAppActionRegistry';
import { getExecutableAppActionGroundingRules } from '../getExecutableAppActionGroundingRules';

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
        expect(result?.mutationIdempotent).toBe(false);
        expect(result?.mutationIdentityRules).toEqual([]);
    });

    it('owns mutation identity independently from capability targets', () => {
        const parentTrackReference = {
            arguments: [{ argument: 'parentTrackIds', cardinality: 'many' as const }],
            destructive: false as const,
            resourceFamily: 'track',
            resourceReferenceOnly: true as const,
        };
        expect(getExecutableAppActionGroundingRules('setTrackOutput')).toMatchObject({
            targetRules: [
                { argument: 'outputId', capability: 'output' },
                { argument: 'trackId', capability: 'routable-source' },
            ],
            mutationIdentityRules: [
                { arguments: [{ argument: 'trackId' }], resourceFamily: 'track' },
                {
                    arguments: [{ argument: 'outputId' }],
                    resourceFamily: 'track',
                    resourceReferenceOnly: true,
                },
            ],
        });
        expect(getExecutableAppActionGroundingRules('setDeviceParameter')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'deviceId' }, { argument: 'paramId' }] },
            parentTrackReference,
        ]);
        expect(getExecutableAppActionGroundingRules('automateTrackGainRange')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'trackIds', cardinality: 'many' }] },
            {
                arguments: [{ argument: 'trackIds', cardinality: 'many' }],
                destructive: false,
                resourceFamily: 'track',
                resourceReferenceOnly: true,
            },
        ]);
        expect(getExecutableAppActionGroundingRules('addAutomationLane')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'trackId' }, { argument: 'parameterId' }] },
            {
                arguments: [{ argument: 'trackId' }],
                destructive: false,
                resourceFamily: 'track',
                resourceReferenceOnly: true,
            },
        ]);
        expect(getExecutableAppActionGroundingRules('addSend')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'trackId' }, { argument: 'busId' }], resourceFamily: 'send' },
            parentTrackReference,
        ]);
        expect(getExecutableAppActionGroundingRules('moveClip')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'clipId' }], resourceFamily: 'clip' },
        ]);
        expect(getExecutableAppActionGroundingRules('copyMidiArticulations')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'targetClipId' }] },
        ]);
        expect(getExecutableAppActionGroundingRules('assignToVca')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'trackId' }], resourceFamily: 'track' },
        ]);
        expect(getExecutableAppActionGroundingRules('addDevice')).toMatchObject({
            mutationIdempotent: false,
            mutationIdentityRules: [
                {
                    arguments: [{ argument: 'trackId' }],
                    resourceFamily: 'track',
                    resourceReferenceOnly: true,
                },
            ],
        });
        expect(getExecutableAppActionGroundingRules('addSidechainRoute')?.mutationIdentityRules).toEqual([
            {
                arguments: [{ argument: 'sourceTrackId' }, { argument: 'targetDeviceId' }],
                fallbackArguments: [{ argument: 'sourceTrackId' }, { argument: 'targetTrackId' }],
            },
            {
                arguments: [{ argument: 'sourceTrackId' }, { argument: 'targetTrackId' }],
                resourceFamily: 'sidechain-route',
                resourceReferenceOnly: true,
            },
            parentTrackReference,
        ]);
        expect(getExecutableAppActionGroundingRules('removeSidechainRoute')?.mutationIdentityRules).toEqual([
            {
                arguments: [{ argument: 'sourceTrackId' }, { argument: 'targetTrackId' }],
                resourceFamily: 'sidechain-route',
                resourceReferenceOnly: true,
            },
            parentTrackReference,
        ]);
        expect(getExecutableAppActionGroundingRules('setTrackGain')?.mutationIdempotent).toBe(true);
        expect(getExecutableAppActionGroundingRules('splitClip')?.mutationIdempotent).toBe(false);
        expect(getExecutableAppActionGroundingRules('removeMarker')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'beat' }, { argument: 'name' }], resourceFamily: 'marker' },
        ]);
        expect(getExecutableAppActionGroundingRules('removeClip')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'clipId' }], resourceFamily: 'clip' },
        ]);
        expect(getExecutableAppActionGroundingRules('removeDevice')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'deviceId' }], resourceFamily: 'device' },
            parentTrackReference,
        ]);
        expect(getExecutableAppActionGroundingRules('removeSend')?.mutationIdentityRules).toEqual([
            { arguments: [{ argument: 'trackId' }, { argument: 'busId' }], resourceFamily: 'send' },
            parentTrackReference,
        ]);
        expect(getExecutableAppActionGroundingRules('removeSection')?.mutationIdentityRules).toEqual([
            {
                arguments: [{ argument: 'startBeat' }, { argument: 'endBeat' }, { argument: 'name' }],
                resourceFamily: 'section',
            },
        ]);
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
