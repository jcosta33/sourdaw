import { describe, it, expect } from 'vitest';

import {
    LEGACY_STRAIGHT_GROOVE_TEMPLATE_ID,
    STRAIGHT_GROOVE_TEMPLATE_ID,
    canonicalizeGrooveTemplateId,
    createStraightGrooveTemplate,
    getCanonicalGrooveTemplateKey,
    getGrooveSubdivisionSlotCount,
    getGrooveSubdivisionStepBeats,
    isGrooveTemplate,
    normalizeGrooveAmount,
    resolveGrooveTemplateIdAlias,
    resolveGrooveTemplateNameCollision,
    type GrooveTemplate,
    type GrooveSubdivision,
} from '../GrooveTemplate';

describe('getCanonicalGrooveTemplateKey', () => {
    it('trims, normalizes (NFKC), and lowercases the name', () => {
        expect(getCanonicalGrooveTemplateKey('  Heavy Swing  ')).toBe('heavy swing');
        // NFKC folds compatibility characters: fullwidth 'Ａ' → 'a'.
        expect(getCanonicalGrooveTemplateKey('Ａｄｄ')).toBe('add');
    });

    it('produces identical keys for names differing only by case', () => {
        expect(getCanonicalGrooveTemplateKey('MPC 60')).toBe(getCanonicalGrooveTemplateKey('mpc 60'));
    });

    it('does not collapse internal whitespace (only trims ends)', () => {
        expect(getCanonicalGrooveTemplateKey('mpc  60')).toBe('mpc  60');
    });
});

describe('canonicalizeGrooveTemplateId', () => {
    it('returns the NFKC-normalized trimmed id for non-empty input', () => {
        expect(canonicalizeGrooveTemplateId('  groove-foo  ')).toBe('groove-foo');
    });

    it('returns null for a whitespace-only id', () => {
        expect(canonicalizeGrooveTemplateId('   ')).toBeNull();
    });

    it('returns null for an empty id', () => {
        expect(canonicalizeGrooveTemplateId('')).toBeNull();
    });
});

describe('resolveGrooveTemplateIdAlias', () => {
    it('maps the legacy "straight" id to the canonical straight id', () => {
        expect(resolveGrooveTemplateIdAlias(LEGACY_STRAIGHT_GROOVE_TEMPLATE_ID)).toBe(STRAIGHT_GROOVE_TEMPLATE_ID);
    });

    it('passes through any other canonical id unchanged', () => {
        expect(resolveGrooveTemplateIdAlias('groove-swing')).toBe('groove-swing');
    });

    it('returns null for an empty id', () => {
        expect(resolveGrooveTemplateIdAlias('')).toBeNull();
    });
});

describe('normalizeGrooveAmount', () => {
    it('clamps values above 1 down to 1', () => {
        expect(normalizeGrooveAmount(1.5)).toBe(1);
    });

    it('clamps negative values up to 0', () => {
        expect(normalizeGrooveAmount(-0.3)).toBe(0);
    });

    it('passes through valid in-range values unchanged', () => {
        expect(normalizeGrooveAmount(0.42)).toBe(0.42);
    });

    it('returns 0 for NaN', () => {
        expect(normalizeGrooveAmount(Number.NaN)).toBe(0);
    });

    it('returns 0 for Infinity', () => {
        expect(normalizeGrooveAmount(Number.POSITIVE_INFINITY)).toBe(0);
    });
});

describe('getGrooveSubdivisionStepBeats', () => {
    it('returns 0.5 beats for 1/8', () => {
        expect(getGrooveSubdivisionStepBeats('1/8')).toBe(0.5);
    });

    it('returns 0.25 beats for 1/16', () => {
        expect(getGrooveSubdivisionStepBeats('1/16')).toBe(0.25);
    });

    it('returns 0.125 beats for 1/32', () => {
        expect(getGrooveSubdivisionStepBeats('1/32')).toBe(0.125);
    });

    it('returns 1/6 beats for triplet 1/16T', () => {
        expect(getGrooveSubdivisionStepBeats('1/16T')).toBeCloseTo(1 / 6, 10);
    });
});

describe('getGrooveSubdivisionSlotCount', () => {
    const cases: ReadonlyArray<{ subdivision: GrooveSubdivision; expected: number }> = [
        { subdivision: '1/8', expected: 8 },
        { subdivision: '1/16', expected: 16 },
        { subdivision: '1/32', expected: 32 },
        { subdivision: '1/16T', expected: 24 },
    ];
    for (const { subdivision, expected } of cases) {
        it(`returns ${expected} slots for ${subdivision}`, () => {
            expect(getGrooveSubdivisionSlotCount(subdivision)).toBe(expected);
        });
    }
});

describe('createStraightGrooveTemplate', () => {
    it('produces a valid canonical straight groove template', () => {
        const template = createStraightGrooveTemplate();
        expect(template.id).toBe(STRAIGHT_GROOVE_TEMPLATE_ID);
        expect(template.name).toBe('Straight');
        expect(template.subdivision).toBe('1/16');
        expect(template.slots).toEqual([]);
        expect(template.provenance).toEqual({ type: 'builtin', sourceId: 'straight' });
        expect(template.schemaVersion).toBe(1);
    });
});

describe('resolveGrooveTemplateNameCollision', () => {
    const existing: ReadonlyArray<Pick<GrooveTemplate, 'id' | 'name'>> = [
        { id: 'groove-a', name: 'Swing' },
        { id: 'groove-b', name: 'Swing 2' },
        { id: 'groove-c', name: 'Swing 3' },
    ];

    it('returns the requested name when it does not collide (case-insensitive)', () => {
        expect(resolveGrooveTemplateNameCollision({ requestedName: 'Funk', templates: existing })).toBe('Funk');
    });

    it('appends the next available numeric suffix on collision', () => {
        // "Swing" and "Swing 2" and "Swing 3" exist → next free is "Swing 4".
        expect(resolveGrooveTemplateNameCollision({ requestedName: 'Swing', templates: existing })).toBe('Swing 4');
    });

    it('fills the first gap in the suffix sequence', () => {
        const gapList: ReadonlyArray<Pick<GrooveTemplate, 'id' | 'name'>> = [
            { id: 'a', name: 'Funk' },
            { id: 'c', name: 'Funk 3' },
        ];
        // "Funk 2" is free → returned.
        expect(resolveGrooveTemplateNameCollision({ requestedName: 'Funk', templates: gapList })).toBe('Funk 2');
    });

    it('ignores the template matching ignoreTemplateId', () => {
        // Renaming groove-a "Swing" → its own name is ignored, so "Swing" is free.
        expect(
            resolveGrooveTemplateNameCollision({
                requestedName: 'Swing',
                templates: existing,
                ignoreTemplateId: 'groove-a',
            })
        ).toBe('Swing');
    });

    it('falls back to "Untitled groove" for an empty requested name', () => {
        expect(resolveGrooveTemplateNameCollision({ requestedName: '   ', templates: [] })).toBe('Untitled groove');
    });

    it('treats names differing only by case as collisions', () => {
        expect(
            resolveGrooveTemplateNameCollision({
                requestedName: 'swing',
                templates: [{ id: 'a', name: 'Swing' }],
            })
        ).toBe('swing 2');
    });
});

describe('isGrooveTemplate', () => {
    function validUserTemplate(overrides: Partial<GrooveTemplate> = {}): GrooveTemplate {
        return {
            id: 'groove-user-1',
            name: 'My Groove',
            schemaVersion: 1,
            subdivision: '1/16',
            slots: [{ index: 0, timingOffset: 0.1, dynamicsOffset: -0.2 }],
            provenance: { type: 'user', sourceId: 'user-1' },
            ...overrides,
        };
    }

    it('accepts a well-formed user template', () => {
        expect(isGrooveTemplate(validUserTemplate())).toBe(true);
    });

    it('accepts a template with no slots', () => {
        expect(isGrooveTemplate(validUserTemplate({ slots: [] }))).toBe(true);
    });

    it('accepts the canonical straight template', () => {
        expect(isGrooveTemplate(createStraightGrooveTemplate())).toBe(true);
    });

    it('rejects a non-object', () => {
        expect(isGrooveTemplate(null)).toBe(false);
        expect(isGrooveTemplate('groove')).toBe(false);
        expect(isGrooveTemplate(42)).toBe(false);
    });

    it('rejects a template with extra keys (exact-shape)', () => {
        expect(isGrooveTemplate({ ...validUserTemplate(), extra: true })).toBe(false);
    });

    it('rejects an empty id', () => {
        expect(isGrooveTemplate(validUserTemplate({ id: '' }))).toBe(false);
    });

    it('rejects a non-canonical id (whitespace)', () => {
        expect(isGrooveTemplate(validUserTemplate({ id: '  groove-x  ' }))).toBe(false);
    });

    it('rejects the legacy "straight" id', () => {
        expect(isGrooveTemplate(validUserTemplate({ id: 'straight' }))).toBe(false);
    });

    it('rejects an empty/whitespace name', () => {
        expect(isGrooveTemplate(validUserTemplate({ name: '   ' }))).toBe(false);
    });

    it('rejects an unknown subdivision', () => {
        expect(isGrooveTemplate(validUserTemplate({ subdivision: '1/64' as GrooveSubdivision }))).toBe(false);
    });

    it('rejects duplicate slot indexes', () => {
        expect(
            isGrooveTemplate(
                validUserTemplate({
                    slots: [
                        { index: 1, timingOffset: 0.1, dynamicsOffset: 0 },
                        { index: 1, timingOffset: 0.2, dynamicsOffset: 0 },
                    ],
                })
            )
        ).toBe(false);
    });

    it('rejects a slot index out of subdivision range', () => {
        // 1/16 → 16 slots; index 16 is out of range.
        expect(
            isGrooveTemplate(validUserTemplate({ slots: [{ index: 16, timingOffset: 0.1, dynamicsOffset: 0 }] }))
        ).toBe(false);
    });

    it('rejects a slot with timingOffset beyond [-0.5, 0.5]', () => {
        expect(
            isGrooveTemplate(validUserTemplate({ slots: [{ index: 0, timingOffset: 0.6, dynamicsOffset: 0 }] }))
        ).toBe(false);
    });

    it('rejects a slot with dynamicsOffset beyond [-1, 1]', () => {
        expect(
            isGrooveTemplate(validUserTemplate({ slots: [{ index: 0, timingOffset: 0, dynamicsOffset: 1.5 }] }))
        ).toBe(false);
    });

    it('rejects an invalid provenance (missing sourceId)', () => {
        expect(isGrooveTemplate(validUserTemplate({ provenance: { type: 'user', sourceId: '' } }))).toBe(false);
    });

    it('rejects a midi-clip provenance with non-positive analyzerVersion', () => {
        expect(
            isGrooveTemplate(
                validUserTemplate({
                    provenance: { type: 'midi-clip', sourceId: 'clip-1', analyzerVersion: 0 },
                })
            )
        ).toBe(false);
    });

    it('rejects a straight template that does not match the canonical shape', () => {
        expect(isGrooveTemplate(validUserTemplate({ id: STRAIGHT_GROOVE_TEMPLATE_ID, name: 'Not Straight' }))).toBe(
            false
        );
    });
});
