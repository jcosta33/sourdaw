import { describe, expect, it } from 'vitest';

import { adaptGrooveTemplateForConsumer } from '../useCases/grooveTemplates/adaptGrooveTemplateForConsumer';

const template = {
    id: 'pocket',
    name: 'Pocket',
    schemaVersion: 1 as const,
    subdivision: '1/32' as const,
    slots: [{ index: 2, timingOffset: 0.2, dynamicsOffset: -0.1 }],
    provenance: { type: 'user' as const, sourceId: 'manual' },
};

describe('groove consumer adapters', () => {
    it('gives semantically identical consumers identical canonical offsets', () => {
        const yeast = adaptGrooveTemplateForConsumer({
            consumer: 'yeast',
            template,
            supportsDynamics: true,
            supportedSubdivisions: ['1/16', '1/32'],
        });
        const toaster = adaptGrooveTemplateForConsumer({
            consumer: 'toaster',
            template,
            supportsDynamics: true,
            supportedSubdivisions: ['1/16', '1/32'],
        });

        expect(yeast).toEqual(expect.objectContaining({ ok: true }));
        expect(toaster).toEqual(expect.objectContaining({ ok: true }));
        if (!yeast.ok || !toaster.ok) {
            throw new Error('Expected supported adapters');
        }
        expect(yeast.projection.timingOffsets).toEqual(toaster.projection.timingOffsets);
        expect(yeast.projection.dynamicsOffsets).toEqual(toaster.projection.dynamicsOffsets);
        expect(yeast.projection).not.toHaveProperty('deviceControls');
    });

    it('reports unsupported dynamics and subdivision precision with typed errors', () => {
        expect(
            adaptGrooveTemplateForConsumer({
                consumer: 'arpeggiator',
                template,
                supportsDynamics: false,
                supportedSubdivisions: ['1/16', '1/32'],
            })
        ).toEqual({ ok: false, error: { code: 'unsupported-dynamics', consumer: 'arpeggiator' } });
        expect(
            adaptGrooveTemplateForConsumer({
                consumer: 'sequencer',
                template,
                supportsDynamics: true,
                supportedSubdivisions: ['1/16'],
            })
        ).toEqual({
            ok: false,
            error: { code: 'unsupported-subdivision', consumer: 'sequencer', subdivision: '1/32' },
        });
    });
});
