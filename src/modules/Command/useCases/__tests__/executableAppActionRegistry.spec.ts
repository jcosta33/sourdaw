import { describe, expect, it } from 'vitest';

import { executableAppActionDescriptors, executableAppActionDescriptorByType } from '../executableAppActionRegistry';

describe('executableAppActionRegistry', () => {
    it('contains action descriptors', () => {
        expect(executableAppActionDescriptors.length).toBeGreaterThan(50);
    });

    it('builds a Map keyed by actionType covering all descriptors', () => {
        expect(executableAppActionDescriptorByType.size).toBe(executableAppActionDescriptors.length);
        for (const descriptor of executableAppActionDescriptors) {
            expect(executableAppActionDescriptorByType.get(descriptor.actionType)).toBe(descriptor);
        }
    });

    it('every descriptor has a non-empty actionType', () => {
        for (const descriptor of executableAppActionDescriptors) {
            expect(descriptor.actionType).toBeTruthy();
            expect(typeof descriptor.actionType).toBe('string');
        }
    });

    it('every descriptor has a valid risk level', () => {
        const validRisks = new Set([
            'bounded-reversible',
            'broad-reversible',
            'destructive-reversible',
            'authority-sensitive',
            'external-effect',
        ]);
        for (const descriptor of executableAppActionDescriptors) {
            expect(validRisks.has(descriptor.risk)).toBe(true);
        }
    });

    it('all actionTypes are unique (no duplicate keys)', () => {
        const types = executableAppActionDescriptors.map((d) => d.actionType);
        expect(new Set(types).size).toBe(types.length);
    });

    it('includes well-known action types', () => {
        const knownTypes = ['addTrack', 'removeTrack', 'muteTrack', 'soloTrack', 'removeClip', 'setTrackGain'];
        for (const type of knownTypes) {
            expect(executableAppActionDescriptorByType.has(type)).toBe(true);
        }
    });

    it('declares audio clip splitting as zero-crossing adjusted', () => {
        const descriptor = executableAppActionDescriptors.find((candidate) => candidate.actionType === 'splitClip');

        expect(descriptor?.description).toContain('nearest zero crossing');
        expect(descriptor?.description).toContain("when the clip's audio buffer is available");
        expect(descriptor?.description).toContain('requested beat');
        expect(descriptor?.parameters.properties.beat.description).toContain('nearest zero crossing');
        expect(descriptor?.parameters.properties.beat.description).toContain('when the audio buffer is available');
        expect(descriptor?.parameters.properties.beat.description).toContain('requested beat');
    });

    it('exposes blank MIDI clip creation without provider-controlled internal state', () => {
        const descriptor = executableAppActionDescriptorByType.get('addClip');

        expect(descriptor).toMatchObject({
            actionType: 'addClip',
            risk: 'bounded-reversible',
            targetRules: [{ argument: 'trackId', capability: 'track', promptRole: 'container' }],
            parameters: {
                required: ['trackId', 'startBeat', 'endBeat', 'name'],
                properties: {
                    trackId: { type: 'string' },
                    startBeat: { type: 'number' },
                    endBeat: { type: 'number' },
                    name: { type: 'string' },
                },
            },
        });
        expect(descriptor?.parameters.properties).not.toHaveProperty('id');
        expect(descriptor?.parameters.properties).not.toHaveProperty('type');
        expect(descriptor?.parameters.properties).not.toHaveProperty('audioBufferId');
    });

    it('exposes exactly two existing clips for reversible MIDI glue', () => {
        const descriptor = executableAppActionDescriptorByType.get('glueClips');

        expect(descriptor).toMatchObject({
            actionType: 'glueClips',
            risk: 'destructive-reversible',
            targetRules: [
                {
                    argument: 'clipIds',
                    capability: 'editable-clip',
                    cardinality: 'many',
                },
            ],
            parameters: {
                required: ['clipIds'],
                properties: {
                    clipIds: {
                        type: 'array',
                        minItems: 2,
                        maxItems: 2,
                        uniqueItems: true,
                    },
                },
            },
        });
        expect(descriptor?.parameters.properties).not.toHaveProperty('targetClipId');
        expect(descriptor?.parameters.properties).not.toHaveProperty('expected');
        expect(descriptor?.parameters.properties).not.toHaveProperty('replacement');
    });

    it('exposes an explicit authority-sensitive punch-enabled setter without replay fields', () => {
        const descriptor = executableAppActionDescriptorByType.get('setPunchEnabled');

        expect(descriptor).toMatchObject({
            actionType: 'setPunchEnabled',
            risk: 'authority-sensitive',
            targetRules: [],
            parameters: {
                required: ['enabled'],
                properties: { enabled: { type: 'boolean' } },
            },
        });
        expect(descriptor?.parameters.properties).not.toHaveProperty('expectedEnabled');
        expect(descriptor?.intentPhrases).toContain('enable punch in/out');
        expect(descriptor?.intentPhrases).toContain('disable punch in/out');
        expect(descriptor?.intentPhrases).not.toContain('enable punch recording');
        expect(descriptor?.intentPhrases).not.toContain('disable punch recording');
        expect(descriptor?.intentPhrases).not.toContain('punch');
        expect(descriptor?.intentPhrases).not.toContain('punch in');
        expect(descriptor?.intentPhrases).not.toContain('punch out');
        expect(descriptor?.intentPhrases).not.toContain('toggle punch');
    });

    it('owns compound automation arrays, batch-local destinations, and adjustment-layer targets', () => {
        expect(executableAppActionDescriptorByType.get('automateTrackGainRange')?.targetRules).toEqual([
            {
                argument: 'trackIds',
                capability: 'routable-source',
                cardinality: 'many',
                promptRole: 'members',
            },
        ]);
        expect(executableAppActionDescriptorByType.get('automateSendRanges')?.targetRules).toEqual([
            {
                argument: 'trackIds',
                capability: 'routable-source',
                cardinality: 'many',
                dependsOn: 'busId',
                promptRole: 'source',
            },
            { argument: 'busId', capability: 'bus', promptRole: 'destination' },
        ]);
        expect(executableAppActionDescriptorByType.get('addAdjustmentRegion')?.targetRules).toEqual([
            { argument: 'layerId', capability: 'adjustment-layer' },
        ]);
    });
});
