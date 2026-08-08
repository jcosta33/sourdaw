import { describe, expect, it } from 'vitest';

import { PUSH_2_PROFILE } from '../ControllerProfile';

describe('PUSH_2_PROFILE', () => {
    it('has a stable id and human-readable name', () => {
        expect(PUSH_2_PROFILE.id).toBe('push-2');
        expect(PUSH_2_PROFILE.name).toBe('Push 2');
        expect(PUSH_2_PROFILE.manufacturer).toBe('Ableton');
    });

    it('productId is a non-empty array of match patterns', () => {
        expect(PUSH_2_PROFILE.productId.length).toBeGreaterThan(0);
        for (const pattern of PUSH_2_PROFILE.productId) {
            expect(pattern.length).toBeGreaterThan(0);
        }
    });

    it('includes at least the play button transport mapping', () => {
        const playMapping = PUSH_2_PROFILE.mappings.find((m) => m.id === 'play-button');
        expect(playMapping).toBeDefined();
        expect(playMapping?.controlType).toBe('button');
        expect(playMapping?.action.type).toBe('transport');
        expect(playMapping?.action.target).toBe('togglePlayback');
    });

    it('every mapping has a valid controlType', () => {
        const validTypes = ['pad', 'knob', 'fader', 'button'];
        for (const mapping of PUSH_2_PROFILE.mappings) {
            expect(validTypes).toContain(mapping.controlType);
        }
    });

    it('every mapping has a valid action type', () => {
        const validActionTypes = ['parameter', 'transport', 'workflow'];
        for (const mapping of PUSH_2_PROFILE.mappings) {
            expect(validActionTypes).toContain(mapping.action.type);
        }
    });

    it('every mapping has a non-negative controlIndex and channel', () => {
        for (const mapping of PUSH_2_PROFILE.mappings) {
            expect(mapping.controlIndex).toBeGreaterThanOrEqual(0);
            expect(mapping.channel).toBeGreaterThanOrEqual(0);
        }
    });

    it('all mapping ids are unique within the profile', () => {
        const ids = PUSH_2_PROFILE.mappings.map((m) => m.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
