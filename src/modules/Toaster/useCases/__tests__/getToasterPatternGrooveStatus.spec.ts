import { describe, it, expect } from 'vitest';

import { defaultGrooveTemplateState, type GrooveTemplateState } from '#/modules/MIDI/stores';

import { getToasterPatternGrooveStatus } from '../getToasterPatternGrooveStatus';

function stateWith(overrides: Partial<GrooveTemplateState> = {}): GrooveTemplateState {
    return { ...structuredClone(defaultGrooveTemplateState), ...overrides };
}

const STRAIGHT_ID = 'groove-straight';

describe('getToasterPatternGrooveStatus', () => {
    it('returns "state-unavailable" when grooveState is undefined', () => {
        const result = getToasterPatternGrooveStatus({
            deviceId: 'dev-1',
            patternId: 'p1',
            stepsPerBar: 16,
            grooveState: undefined,
        });
        expect(result.status).toBe('state-unavailable');
    });

    it('returns "invalid-consumer" for an empty patternId', () => {
        const result = getToasterPatternGrooveStatus({
            deviceId: 'dev-1',
            patternId: '   ',
            stepsPerBar: 16,
            grooveState: stateWith(),
        });
        expect(result.status).toBe('invalid-consumer');
    });

    it('returns "unassigned" when no groove assignment matches the pattern', () => {
        const result = getToasterPatternGrooveStatus({
            deviceId: 'dev-1',
            patternId: 'p1',
            stepsPerBar: 16,
            grooveState: stateWith({ assignments: [] }),
        });
        expect(result.status).toBe('unassigned');
    });

    it('returns "ready" with the straight template when assigned to straight (amount 0)', () => {
        // The scoped consumer id for dev-1/p1.
        const scopedId = 'groove-consumer:dev-1:p1';
        const grooveState = stateWith({
            assignments: [
                {
                    consumerType: 'toaster-pattern',
                    consumerId: scopedId,
                    templateId: STRAIGHT_ID,
                    amount: 0,
                },
            ],
        });
        const result = getToasterPatternGrooveStatus({
            deviceId: 'dev-1',
            patternId: 'p1',
            stepsPerBar: 16,
            grooveState,
        });
        expect(result.status).toBe('ready');
        if (result.status === 'ready') {
            expect(result.templateId).toBe(STRAIGHT_ID);
            expect(result.amount).toBe(0);
        }
    });

    it('returns "missing-template" when the assignment references a nonexistent template', () => {
        const scopedId = 'groove-consumer:dev-1:p1';
        const grooveState = stateWith({
            assignments: [
                {
                    consumerType: 'toaster-pattern',
                    consumerId: scopedId,
                    templateId: 'groove-nonexistent',
                    amount: 0.5,
                },
            ],
        });
        const result = getToasterPatternGrooveStatus({
            deviceId: 'dev-1',
            patternId: 'p1',
            stepsPerBar: 16,
            grooveState,
        });
        expect(result.status).toBe('missing-template');
        if (result.status === 'missing-template') {
            expect(result.templateId).toBe('groove-nonexistent');
        }
    });

    it('returns "ready" for a real groove template adapted to 1/16', () => {
        // Use a builtin swing template (1/16 subdivision).
        const swing = defaultGrooveTemplateState.templates.find((t) => t.id === 'swing-light')!;
        const scopedId = 'groove-consumer:dev-1:p1';
        const grooveState = stateWith({
            assignments: [
                {
                    consumerType: 'toaster-pattern',
                    consumerId: scopedId,
                    templateId: swing.id,
                    amount: 0.5,
                },
            ],
        });
        const result = getToasterPatternGrooveStatus({
            deviceId: 'dev-1',
            patternId: 'p1',
            stepsPerBar: 16,
            grooveState,
        });
        expect(result.status).toBe('ready');
        if (result.status === 'ready') {
            expect(result.templateId).toBe(swing.id);
            expect(result.templateName).toBe(swing.name);
            expect(result.amount).toBe(0.5);
        }
    });

    it('returns "unsupported" when the groove subdivision does not match stepsPerBar', () => {
        // swing-light is 1/16; a Toaster with stepsPerBar=32 expects 1/32.
        const swing = defaultGrooveTemplateState.templates.find((t) => t.id === 'swing-light')!;
        const scopedId = 'groove-consumer:dev-1:p1';
        const grooveState = stateWith({
            assignments: [
                {
                    consumerType: 'toaster-pattern',
                    consumerId: scopedId,
                    templateId: swing.id,
                    amount: 0.5,
                },
            ],
        });
        const result = getToasterPatternGrooveStatus({
            deviceId: 'dev-1',
            patternId: 'p1',
            stepsPerBar: 32,
            grooveState,
        });
        // 1/16 template cannot adapt to a 1/32-only consumer → unsupported.
        expect(result.status).toBe('unsupported');
        if (result.status === 'unsupported') {
            expect(result.error.code).toBe('unsupported-subdivision');
        }
    });

    it('returns "unsupported" for an unsupported stepsPerBar value (e.g. 8)', () => {
        // stepsPerBar 8 → getSupportedSubdivisions returns [] → any non-straight template fails.
        const swing = defaultGrooveTemplateState.templates.find((t) => t.id === 'swing-light')!;
        const scopedId = 'groove-consumer:dev-1:p1';
        const grooveState = stateWith({
            assignments: [
                {
                    consumerType: 'toaster-pattern',
                    consumerId: scopedId,
                    templateId: swing.id,
                    amount: 0.5,
                },
            ],
        });
        const result = getToasterPatternGrooveStatus({
            deviceId: 'dev-1',
            patternId: 'p1',
            stepsPerBar: 8,
            grooveState,
        });
        expect(result.status).toBe('unsupported');
    });

    it('resolves via the legacy canonical-consumerId assignment path', () => {
        // The legacy path uses consumerId = canonicalPatternId (the raw 'p1'),
        // not the scoped 'groove-consumer:dev-1:p1' form.
        const swing = defaultGrooveTemplateState.templates.find((t) => t.id === 'swing-light')!;
        const grooveState = stateWith({
            assignments: [
                {
                    consumerType: 'toaster-pattern',
                    consumerId: 'p1',
                    templateId: swing.id,
                    amount: 0.5,
                },
            ],
        });
        const result = getToasterPatternGrooveStatus({
            deviceId: 'dev-1',
            patternId: 'p1',
            stepsPerBar: 16,
            grooveState,
        });
        expect(result.status).toBe('ready');
        if (result.status === 'ready') {
            expect(result.templateId).toBe(swing.id);
        }
    });
});
