import { describe, expect, it } from 'vitest';

import { TOOL_LABELS } from '../../../models/EditingTool';
import { TOOL_SHORTCUTS } from '../helpers';

/** Pulls the advertised letter out of a label such as `Marquee (E)` / `Draw (D/B)`. */
const advertisedLetters = (label: string): string[] => {
    const match = /\(([A-Z](?:\/[A-Z])*)\)$/.exec(label);
    const captured = match?.[1];
    if (!captured) {
        return [];
    }
    return captured.split('/').map((letter) => letter.toLowerCase());
};

describe('workspaceQueries helpers', () => {
    it('should map editing tool shortcuts', () => {
        expect(TOOL_SHORTCUTS.s).toBe('select');
        expect(TOOL_SHORTCUTS.c).toBe('cut');
        expect(TOOL_SHORTCUTS.d).toBe('draw');
        expect(TOOL_SHORTCUTS.b).toBe('draw');
        expect(TOOL_SHORTCUTS.t).toBe('stretch');
        expect(TOOL_SHORTCUTS.e).toBe('marquee');
    });

    // The keyboard path reads this constant (via `useCases/index.ts`), while the
    // toolbar tooltip reads TOOL_LABELS. Asserting one against the other catches a
    // tool whose UI promises a letter the keyboard map does not bind — the exact
    // shape of the divergence that left `e` / Marquee unreachable.
    it('binds every letter its own tool label advertises to that tool', () => {
        const advertised = Object.entries(TOOL_LABELS).flatMap(([tool, label]) =>
            advertisedLetters(label).map((letter) => ({ letter, tool }))
        );
        const bound = advertised.map(({ letter }) => ({ letter, tool: TOOL_SHORTCUTS[letter] }));
        expect(bound).toStrictEqual(advertised);
    });
});
