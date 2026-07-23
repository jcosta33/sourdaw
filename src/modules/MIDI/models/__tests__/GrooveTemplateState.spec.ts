import { describe, it, expect } from 'vitest';

import { STRAIGHT_GROOVE_TEMPLATE_ID, type GrooveTemplate } from '../GrooveTemplate';
import {
    canonicalizeGrooveConsumerId,
    defaultGrooveTemplateState,
    isGrooveTemplateAssignment,
    isGrooveTemplateState,
    sanitizeGrooveTemplateState,
    type GrooveTemplateAssignment,
    type GrooveTemplateState,
} from '../GrooveTemplateState';

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

function validAssignment(overrides: Partial<GrooveTemplateAssignment> = {}): GrooveTemplateAssignment {
    return {
        consumerType: 'clip',
        consumerId: 'clip-1',
        templateId: STRAIGHT_GROOVE_TEMPLATE_ID,
        amount: 0.5,
        ...overrides,
    };
}

describe('canonicalizeGrooveConsumerId', () => {
    it('returns the NFKC-normalized trimmed id for non-empty input', () => {
        expect(canonicalizeGrooveConsumerId('  clip-1  ')).toBe('clip-1');
    });

    it('returns null for a whitespace-only id', () => {
        expect(canonicalizeGrooveConsumerId('   ')).toBeNull();
    });

    it('returns null for an empty id', () => {
        expect(canonicalizeGrooveConsumerId('')).toBeNull();
    });
});

describe('isGrooveTemplateAssignment', () => {
    it('accepts a well-formed assignment', () => {
        expect(isGrooveTemplateAssignment(validAssignment())).toBe(true);
    });

    it('accepts every consumer type', () => {
        for (const consumerType of [
            'clip',
            'yeast-processor',
            'toaster-pattern',
            'arpeggiator',
            'sequencer',
        ] as const) {
            expect(isGrooveTemplateAssignment(validAssignment({ consumerType }))).toBe(true);
        }
    });

    it('rejects a non-object', () => {
        expect(isGrooveTemplateAssignment(null)).toBe(false);
        expect(isGrooveTemplateAssignment('x')).toBe(false);
    });

    it('rejects an unknown consumer type', () => {
        expect(isGrooveTemplateAssignment(validAssignment({ consumerType: 'unknown' as never }))).toBe(false);
    });

    it('rejects a non-canonical consumerId (whitespace)', () => {
        expect(isGrooveTemplateAssignment(validAssignment({ consumerId: '  clip-1  ' }))).toBe(false);
    });

    it('rejects a legacy "straight" templateId', () => {
        expect(isGrooveTemplateAssignment(validAssignment({ templateId: 'straight' }))).toBe(false);
    });

    it('rejects an amount below 0', () => {
        expect(isGrooveTemplateAssignment(validAssignment({ amount: -0.1 }))).toBe(false);
    });

    it('rejects an amount above 1', () => {
        expect(isGrooveTemplateAssignment(validAssignment({ amount: 1.1 }))).toBe(false);
    });

    it('rejects an extra key (exact-shape)', () => {
        expect(isGrooveTemplateAssignment({ ...validAssignment(), extra: true })).toBe(false);
    });
});

describe('isGrooveTemplateState', () => {
    it('accepts the default (builtin) state', () => {
        expect(isGrooveTemplateState(defaultGrooveTemplateState)).toBe(true);
    });

    it('accepts a state with a valid user template and assignment', () => {
        const state: GrooveTemplateState = {
            templates: [...defaultGrooveTemplateState.templates, validUserTemplate()],
            assignments: [validAssignment()],
        };
        expect(isGrooveTemplateState(state)).toBe(true);
    });

    it('rejects a non-object', () => {
        expect(isGrooveTemplateState(null)).toBe(false);
    });

    it('rejects a state with extra keys', () => {
        expect(isGrooveTemplateState({ ...defaultGrooveTemplateState, extra: true })).toBe(false);
    });

    it('rejects duplicate template ids', () => {
        const dup = validUserTemplate();
        const state = {
            templates: [...defaultGrooveTemplateState.templates, dup, { ...dup, name: 'Other' }],
            assignments: [],
        };
        expect(isGrooveTemplateState(state)).toBe(false);
    });

    it('rejects duplicate canonical template names (case-insensitive)', () => {
        const state = {
            templates: [
                ...defaultGrooveTemplateState.templates,
                validUserTemplate({ id: 'g-1', name: 'Swing X' }),
                validUserTemplate({ id: 'g-2', name: 'swing x' }),
            ],
            assignments: [],
        };
        expect(isGrooveTemplateState(state)).toBe(false);
    });

    it('rejects a non-canonical straight builtin (wrong name)', () => {
        const tampered = defaultGrooveTemplateState.templates.map((template) =>
            template.id === STRAIGHT_GROOVE_TEMPLATE_ID ? { ...template, name: 'Crooked' } : template
        );
        expect(isGrooveTemplateState({ templates: tampered, assignments: [] })).toBe(false);
    });

    it('rejects an assignment referencing an unknown templateId', () => {
        const state = {
            templates: defaultGrooveTemplateState.templates,
            assignments: [validAssignment({ templateId: 'groove-nonexistent' })],
        };
        expect(isGrooveTemplateState(state)).toBe(false);
    });

    it('rejects duplicate assignment keys (same consumerType + consumerId)', () => {
        const state = {
            templates: defaultGrooveTemplateState.templates,
            assignments: [
                validAssignment({ consumerId: 'clip-1' }),
                validAssignment({ consumerId: 'clip-1', amount: 0.8 }),
            ],
        };
        expect(isGrooveTemplateState(state)).toBe(false);
    });
});

describe('sanitizeGrooveTemplateState', () => {
    it('returns the default builtin state for null input', () => {
        const result = sanitizeGrooveTemplateState(null);
        expect(result.templates.map((template) => template.id)).toEqual(
            defaultGrooveTemplateState.templates.map((template) => template.id)
        );
        expect(result.assignments).toEqual([]);
    });

    it('preserves a valid user template', () => {
        const result = sanitizeGrooveTemplateState({
            templates: [...defaultGrooveTemplateState.templates, validUserTemplate()],
            assignments: [],
        });
        expect(result.templates.some((template) => template.id === 'groove-user-1')).toBe(true);
    });

    it('canonicalizes a non-canonical (whitespace-padded) user template id', () => {
        const padded = validUserTemplate({ id: '  groove-user-1  ' });
        const result = sanitizeGrooveTemplateState({
            templates: [...defaultGrooveTemplateState.templates, padded],
            assignments: [],
        });
        // The id is trimmed/normalized to the canonical form and survives.
        const canonical = result.templates.find((template) => template.id === 'groove-user-1');
        expect(canonical).toBeDefined();
        // The padded raw id did NOT survive as a separate entry.
        expect(result.templates.some((template) => template.id === '  groove-user-1  ')).toBe(false);
    });

    it('drops a duplicate template whose id collides with an existing builtin', () => {
        // A second valid template claiming the builtin 'swing-light' id is dropped
        // (the builtin already occupies that id), exercising the ids.has dedup guard.
        const colliding = validUserTemplate({ id: 'swing-light', name: 'Fake Swing' });
        const result = sanitizeGrooveTemplateState({
            templates: [...defaultGrooveTemplateState.templates, colliding],
            assignments: [],
        });
        const lightSwings = result.templates.filter((template) => template.id === 'swing-light');
        expect(lightSwings).toHaveLength(1);
        // The builtin is kept, not the fake.
        expect(lightSwings[0]!.name).toBe('Light Swing');
    });

    it('remaps a legacy templateId in an assignment to the canonical straight id', () => {
        const result = sanitizeGrooveTemplateState({
            templates: defaultGrooveTemplateState.templates,
            assignments: [validAssignment({ templateId: 'straight' })],
        });
        expect(result.assignments[0]!.templateId).toBe(STRAIGHT_GROOVE_TEMPLATE_ID);
    });

    it('falls back an unknown templateId in an assignment to the straight id', () => {
        const result = sanitizeGrooveTemplateState({
            templates: defaultGrooveTemplateState.templates,
            assignments: [validAssignment({ templateId: 'does-not-exist' })],
        });
        expect(result.assignments[0]!.templateId).toBe(STRAIGHT_GROOVE_TEMPLATE_ID);
    });

    it('clamps an out-of-range assignment amount into [0, 1]', () => {
        const result = sanitizeGrooveTemplateState({
            templates: defaultGrooveTemplateState.templates,
            assignments: [validAssignment({ amount: 2.5 })],
        });
        expect(result.assignments[0]!.amount).toBe(1);
    });

    it('drops a duplicate assignment, keeping the last one per consumer key', () => {
        const result = sanitizeGrooveTemplateState({
            templates: defaultGrooveTemplateState.templates,
            assignments: [
                validAssignment({ consumerId: 'clip-1', amount: 0.2 }),
                validAssignment({ consumerId: 'clip-1', amount: 0.9 }),
            ],
        });
        expect(result.assignments).toHaveLength(1);
        expect(result.assignments[0]!.amount).toBe(0.9);
    });

    it('skips malformed templates (non-string id) without throwing', () => {
        const result = sanitizeGrooveTemplateState({
            templates: [...defaultGrooveTemplateState.templates, { id: 123 }, 'garbage'],
            assignments: [],
        });
        // Only valid builtin templates survive.
        expect(result.templates.length).toBe(defaultGrooveTemplateState.templates.length);
    });

    it('renames a user template whose name collides with a builtin', () => {
        // A user template claiming the "Straight" name must be renamed.
        const result = sanitizeGrooveTemplateState({
            templates: [
                ...defaultGrooveTemplateState.templates,
                validUserTemplate({ id: 'groove-claim', name: 'Straight' }),
            ],
            assignments: [],
        });
        const claimed = result.templates.find((template) => template.id === 'groove-claim');
        expect(claimed).toBeDefined();
        // Exact collision-resolved name: "Straight" exists → next free is "Straight 2".
        expect(claimed!.name).toBe('Straight 2');
    });

    it('drops an assignment with an invalid consumerType', () => {
        // An unknown consumerType passes the early shape guard but is rejected by
        // isGrooveTemplateAssignment, exercising the drop branch.
        const result = sanitizeGrooveTemplateState({
            templates: defaultGrooveTemplateState.templates,
            assignments: [
                {
                    consumerType: 'bogus' as never,
                    consumerId: 'clip-1',
                    templateId: STRAIGHT_GROOVE_TEMPLATE_ID,
                    amount: 0.5,
                },
            ],
        });
        expect(result.assignments).toHaveLength(0);
    });

    it('preserves a midi-clip provenance template through the structuredClone path', () => {
        const midiClipTemplate = validUserTemplate({
            provenance: { type: 'midi-clip', sourceId: 'clip-9', analyzerVersion: 3 },
        });
        const result = sanitizeGrooveTemplateState({
            templates: [...defaultGrooveTemplateState.templates, midiClipTemplate],
            assignments: [],
        });
        const surviving = result.templates.find((template) => template.id === 'groove-user-1');
        expect(surviving).toBeDefined();
        expect(surviving!.provenance).toEqual({ type: 'midi-clip', sourceId: 'clip-9', analyzerVersion: 3 });
    });

    it('produces output that itself passes isGrooveTemplateState', () => {
        const result = sanitizeGrooveTemplateState({
            templates: [...defaultGrooveTemplateState.templates, validUserTemplate()],
            assignments: [validAssignment()],
        });
        expect(isGrooveTemplateState(result)).toBe(true);
    });
});
