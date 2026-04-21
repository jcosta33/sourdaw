import { describe, it, expect, vi, beforeEach } from 'vitest';

import { previewLoops } from '../previewLoops';
import { templatePreviewPlayer } from '../TemplatePreviewPlayer';

describe('TemplatePreviewPlayer', () => {
    beforeEach(() => {
        templatePreviewPlayer.stop();
    });

    it('can be stopped safely when never started', () => {
        expect(() => {
            templatePreviewPlayer.stop();
        }).not.toThrow();
    });

    it('does not throw when the context is suspended', () => {
        const preview = previewLoops['pop-song'];
        expect(preview).toBeDefined();
        if (!preview) {
            return;
        }
        expect(() => {
            templatePreviewPlayer.play(preview);
        }).not.toThrow();
    });

    it('replacing a preview stops the previous one', () => {
        const pop = previewLoops['pop-song'];
        const edm = previewLoops.edm;
        expect(pop).toBeDefined();
        expect(edm).toBeDefined();
        if (!pop || !edm) {
            return;
        }
        const stopSpy = vi.spyOn(templatePreviewPlayer, 'stop');
        templatePreviewPlayer.play(pop);
        templatePreviewPlayer.play(edm);
        expect(stopSpy).toHaveBeenCalled();
        stopSpy.mockRestore();
    });
});
