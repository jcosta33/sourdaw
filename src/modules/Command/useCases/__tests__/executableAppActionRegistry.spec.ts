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
});
