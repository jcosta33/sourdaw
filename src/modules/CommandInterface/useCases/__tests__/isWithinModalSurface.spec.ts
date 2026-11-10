import { describe, expect, it } from 'vitest';

import { isWithinModalSurface } from '../isWithinModalSurface';

const childOf = (role: string): Element => {
    const surface = document.createElement('div');
    surface.setAttribute('role', role);
    const child = document.createElement('button');
    surface.append(child);
    return child;
};

describe('isWithinModalSurface', () => {
    it.each(['dialog', 'alertdialog', 'menu', 'listbox'])('is true inside a %s surface', (role) => {
        expect(isWithinModalSurface(childOf(role))).toBe(true);
    });

    it('is true for the surface element itself', () => {
        const surface = document.createElement('div');
        surface.setAttribute('role', 'dialog');
        expect(isWithinModalSurface(surface)).toBe(true);
    });

    it.each(['region', 'toolbar', 'application'])('is false inside a %s role', (role) => {
        expect(isWithinModalSurface(childOf(role))).toBe(false);
    });

    it('is false for a bare element, a non-element target and null', () => {
        expect(isWithinModalSurface(document.createElement('div'))).toBe(false);
        expect(isWithinModalSurface(window)).toBe(false);
        expect(isWithinModalSurface(null)).toBe(false);
    });
});
