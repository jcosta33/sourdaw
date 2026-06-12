import { describe, it, expect } from 'vitest';

import { getPreviewLoop, previewLoops } from '../previewLoops';

const EXPECTED_TEMPLATE_IDS = [
    'pop-song',
    'hiphop-trap',
    'edm',
    'rock-band',
    'lofi',
    'cinematic',
    'podcast',
    'singer-songwriter',
    'ambient',
    'demo-nebula-drift',
] as const;

describe('previewLoops', () => {
    it('defines a preview for every supported template id', () => {
        for (const id of EXPECTED_TEMPLATE_IDS) {
            const preview = previewLoops[id];
            expect(preview, `missing preview for ${id}`).toBeDefined();
            expect(preview?.templateId).toBe(id);
        }
    });

    it('each preview has a positive bpm, bar count, and at least one event', () => {
        for (const id of EXPECTED_TEMPLATE_IDS) {
            const preview = previewLoops[id];
            expect(preview).toBeDefined();
            if (!preview) {
                continue;
            }
            expect(preview.bpm).toBeGreaterThan(30);
            expect(preview.bpm).toBeLessThan(300);
            expect(preview.bars).toBeGreaterThan(0);
            expect(preview.events.length).toBeGreaterThan(0);
        }
    });

    it('every event has a known voice, non-negative beat, and positive duration', () => {
        const validVoices = new Set(['kick', 'snare', 'hat', 'bass', 'lead', 'pad', 'chord', 'pluck']);
        for (const id of EXPECTED_TEMPLATE_IDS) {
            const preview = previewLoops[id];
            if (!preview) {
                continue;
            }
            for (const event of preview.events) {
                expect(validVoices.has(event.voice)).toBe(true);
                expect(event.beat).toBeGreaterThanOrEqual(0);
                expect(event.duration).toBeGreaterThan(0);
                expect(event.pitch).toBeGreaterThanOrEqual(0);
                expect(event.pitch).toBeLessThanOrEqual(127);
            }
        }
    });

    it('returns null for unknown template ids via getPreviewLoop', () => {
        expect(getPreviewLoop('definitely-not-a-template')).toBeNull();
    });

    it('returns the matching preview via getPreviewLoop', () => {
        const preview = getPreviewLoop('pop-song');
        expect(preview).not.toBeNull();
        expect(preview?.bpm).toBe(100);
    });
});
