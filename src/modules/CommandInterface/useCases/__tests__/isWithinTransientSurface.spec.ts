import { describe, expect, it } from 'vitest';

import { isWithinTransientSurface } from '../isWithinTransientSurface';

const childOf = (surface: HTMLElement): Element => {
    const child = document.createElement('div');
    surface.append(child);
    return child;
};

const withRole = (role: string): HTMLElement => {
    const element = document.createElement('div');
    element.setAttribute('role', role);
    return element;
};

describe('isWithinTransientSurface', () => {
    it.each(['dialog', 'alertdialog', 'menu'])('is true inside a %s', (role) => {
        expect(isWithinTransientSurface(childOf(withRole(role)))).toBe(true);
    });

    it('is true inside a listbox that belongs to an open popper (a select)', () => {
        const popper = document.createElement('div');
        popper.setAttribute('data-radix-popper-content-wrapper', '');
        const listbox = withRole('listbox');
        popper.append(listbox);
        expect(isWithinTransientSurface(childOf(listbox))).toBe(true);
    });

    it('is false inside a persistent listbox, a tooltip and a bare element', () => {
        expect(isWithinTransientSurface(childOf(withRole('listbox')))).toBe(false);

        const popper = document.createElement('div');
        popper.setAttribute('data-radix-popper-content-wrapper', '');
        const tooltip = withRole('tooltip');
        popper.append(tooltip);
        expect(isWithinTransientSurface(childOf(tooltip))).toBe(false);

        expect(isWithinTransientSurface(document.createElement('div'))).toBe(false);
        expect(isWithinTransientSurface(null)).toBe(false);
    });
});
