import { describe, expect, it } from 'vitest';

import { type GrooveTemplate } from '../../../models/GrooveTemplate';
import { adaptGrooveTemplateForConsumer } from '../adaptGrooveTemplateForConsumer';

function template(subdivision: GrooveTemplate['subdivision'], slots: GrooveTemplate['slots']): GrooveTemplate {
    return {
        id: 'test',
        name: 'Test',
        schemaVersion: 1,
        subdivision,
        slots,
        provenance: { type: 'builtin', sourceId: 'test' },
    };
}

describe('adaptGrooveTemplateForConsumer', () => {
    it('returns unsupported-subdivision when the template subdivision is not in supportedSubdivisions', () => {
        const result = adaptGrooveTemplateForConsumer({
            consumer: 'sequencer',
            template: template('1/32', []),
            supportsDynamics: true,
            supportedSubdivisions: ['1/16'],
        });
        expect(result.ok).toBe(false);
        if (!result.ok && result.error.code === 'unsupported-subdivision') {
            expect(result.error.subdivision).toBe('1/32');
        }
    });

    it('returns unsupported-dynamics when template has dynamics but consumer does not support them', () => {
        const result = adaptGrooveTemplateForConsumer({
            consumer: 'yeast',
            template: template('1/16', [{ index: 0, timingOffset: 0, dynamicsOffset: -0.3 }]),
            supportsDynamics: false,
            supportedSubdivisions: ['1/16'],
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('unsupported-dynamics');
        }
    });

    it('succeeds and projects timing/dynamics offsets into slot-sized arrays', () => {
        const result = adaptGrooveTemplateForConsumer({
            consumer: 'toaster',
            template: template('1/16', [
                { index: 0, timingOffset: 0, dynamicsOffset: 0 },
                { index: 1, timingOffset: 0.12, dynamicsOffset: -0.3 },
            ]),
            supportsDynamics: true,
            supportedSubdivisions: ['1/16'],
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.projection.subdivision).toBe('1/16');
            // 1/16 has 16 slots
            expect(result.projection.timingOffsets).toHaveLength(16);
            expect(result.projection.dynamicsOffsets).toHaveLength(16);
            expect(result.projection.timingOffsets[0]).toBe(0);
            expect(result.projection.timingOffsets[1]).toBe(0.12);
            expect(result.projection.dynamicsOffsets[1]).toBe(-0.3);
        }
    });

    it('ignores slots with index >= slotCount', () => {
        const result = adaptGrooveTemplateForConsumer({
            consumer: 'sequencer',
            template: template('1/8', [{ index: 99, timingOffset: 0.5, dynamicsOffset: 0.5 }]),
            supportsDynamics: true,
            supportedSubdivisions: ['1/8'],
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            // 1/8 has 8 slots, all should be 0 (the index-99 slot is ignored)
            expect(result.projection.timingOffsets.every((v) => v === 0)).toBe(true);
        }
    });

    it('passes when template has dynamics=0 and consumer does not support dynamics', () => {
        const result = adaptGrooveTemplateForConsumer({
            consumer: 'yeast',
            template: template('1/16', [{ index: 0, timingOffset: 0.1, dynamicsOffset: 0 }]),
            supportsDynamics: false,
            supportedSubdivisions: ['1/16'],
        });
        expect(result.ok).toBe(true);
    });
});
