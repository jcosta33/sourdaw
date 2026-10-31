import { afterEach, describe, expect, it } from 'vitest';

import { hasOpenModalSurface } from '../hasOpenModalSurface';

describe('hasOpenModalSurface', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    const addSurface = (role: string): HTMLElement => {
        const surface = document.createElement('div');
        surface.setAttribute('role', role);
        document.body.append(surface);
        return surface;
    };

    it('is false for an empty document and for non-modal roles', () => {
        expect(hasOpenModalSurface()).toBe(false);
        addSurface('region');
        expect(hasOpenModalSurface()).toBe(false);
    });

    it.each(['dialog', 'alertdialog', 'menu', 'listbox'])('is true while a %s is open anywhere', (role) => {
        addSurface(role);
        expect(hasOpenModalSurface()).toBe(true);
    });

    it('ignores a surface that hosts the excepted element but counts a sibling', () => {
        const host = addSurface('dialog');
        const inside = document.createElement('div');
        host.append(inside);
        expect(hasOpenModalSurface(inside)).toBe(false);
        addSurface('menu');
        expect(hasOpenModalSurface(inside)).toBe(true);
    });
});
