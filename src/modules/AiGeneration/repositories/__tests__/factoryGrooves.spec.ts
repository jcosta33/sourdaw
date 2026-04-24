import { describe, it, expect } from 'vitest';

import { FACTORY_GROOVES, getGrooveById } from '../factoryGrooves';

describe('factoryGrooves', () => {
    it('exports a non-empty array of factory grooves', () => {
        expect(FACTORY_GROOVES).toBeInstanceOf(Array);
        expect(FACTORY_GROOVES.length).toBeGreaterThan(0);
    });

    it('getGrooveById returns the correct groove template', () => {
        const groove = getGrooveById('swing-light');
        expect(groove).toBeDefined();
        expect(groove?.name).toBe('Light Swing');
        expect(groove?.subdivisions).toBe(16);
        expect(groove?.offsets.length).toBe(16);
        expect(groove?.velocities.length).toBe(16);
    });

    it('getGrooveById returns undefined for unknown ID', () => {
        expect(getGrooveById('unknown-groove')).toBeUndefined();
    });

    it('ensures straight groove is flat', () => {
        const straight = getGrooveById('straight');
        expect(straight?.offsets.every((output) => output === 0)).toBe(true);
        expect(straight?.velocities.every((value) => value === 1)).toBe(true);
    });
});
