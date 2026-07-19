import { describe, expect, it } from 'vitest';

import { type GrooveTemplateState } from '#/modules/MIDI/stores';

import { getToasterPatternGrooveStatus } from '../getToasterPatternGrooveStatus';

function stateWithTemplate(subdivision: '1/8' | '1/16T'): GrooveTemplateState {
    const templateId = `unsupported-${subdivision}`;
    return {
        templates: [
            {
                id: templateId,
                name: `Unsupported ${subdivision}`,
                schemaVersion: 1,
                subdivision,
                slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
                provenance: { type: 'user', sourceId: templateId },
            },
        ],
        assignments: [
            {
                consumerType: 'toaster-pattern',
                consumerId: 'groove-consumer:device-1:A1',
                templateId,
                amount: 1,
            },
        ],
    };
}

describe('getToasterPatternGrooveStatus', () => {
    it.each(['1/8', '1/16T'] as const)('returns a typed unsupported status for a %s assignment', (subdivision) => {
        expect(
            getToasterPatternGrooveStatus({
                deviceId: 'device-1',
                patternId: 'A1',
                stepsPerBar: 16,
                grooveState: stateWithTemplate(subdivision),
            })
        ).toEqual({
            status: 'unsupported',
            templateId: `unsupported-${subdivision}`,
            templateName: `Unsupported ${subdivision}`,
            error: { code: 'unsupported-subdivision', consumer: 'toaster', subdivision },
        });
    });

    it('prefers the device-scoped assignment over a legacy pattern-only assignment', () => {
        const grooveState: GrooveTemplateState = {
            templates: [
                {
                    id: 'legacy-unsupported',
                    name: 'Legacy unsupported',
                    schemaVersion: 1,
                    subdivision: '1/8',
                    slots: [],
                    provenance: { type: 'user', sourceId: 'legacy' },
                },
                {
                    id: 'scoped-ready',
                    name: 'Scoped ready',
                    schemaVersion: 1,
                    subdivision: '1/16',
                    slots: [],
                    provenance: { type: 'user', sourceId: 'scoped' },
                },
            ],
            assignments: [
                {
                    consumerType: 'toaster-pattern',
                    consumerId: 'A1',
                    templateId: 'legacy-unsupported',
                    amount: 1,
                },
                {
                    consumerType: 'toaster-pattern',
                    consumerId: 'groove-consumer:device-1:A1',
                    templateId: 'scoped-ready',
                    amount: 0.75,
                },
            ],
        };

        expect(
            getToasterPatternGrooveStatus({
                deviceId: 'device-1',
                patternId: 'A1',
                stepsPerBar: 16,
                grooveState,
            })
        ).toEqual({
            status: 'ready',
            templateId: 'scoped-ready',
            templateName: 'Scoped ready',
            amount: 0.75,
        });
    });
});
