import { describe, expect, it, vi, beforeEach } from 'vitest';

import { detectTransientsForClip, quantizeTransients } from '#/modules/ElasticAudio/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { handleDetectTransients } from '../handleDetectTransients';
import { handleQuantizeTransients } from '../handleQuantizeTransients';

vi.mock('#/modules/ElasticAudio/useCases', () => ({
    detectTransientsForClip: vi.fn(),
    quantizeTransients: vi.fn(),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

describe('handleDetectTransients', () => {
    beforeEach(() => vi.clearAllMocks());

    it.each([
        ['CLIP_NOT_FOUND', 'Clip not found'],
        ['CLIP_NOT_AUDIO', 'Transient detection only works on audio clips'],
        ['NO_BUFFER', 'Audio buffer is missing or still loading'],
        ['NO_TEMPO', 'Cannot detect transients without a project tempo'],
    ] as const)('notifies the mapped error message on reason %s', (reason, message) => {
        vi.mocked(detectTransientsForClip).mockReturnValue({ ok: false, reason });
        handleDetectTransients.execute({ type: 'detectTransients', payload: { clipId: 'c1' } });
        expect(notifyUser).toHaveBeenCalledWith(message, 'error');
    });

    it('passes sensitivity default of 0.5 and notifies the success summary', () => {
        vi.mocked(detectTransientsForClip).mockReturnValue({ ok: true, added: 4, kept: 2, removed: 1 });
        handleDetectTransients.execute({ type: 'detectTransients', payload: { clipId: 'c1' } });
        expect(detectTransientsForClip).toHaveBeenCalledWith('c1', 0.5);
        expect(notifyUser).toHaveBeenCalledWith('Detected 4 transients (2 preserved)', 'success');
    });

    it('forwards an explicit sensitivity through the payload', () => {
        vi.mocked(detectTransientsForClip).mockReturnValue({ ok: true, added: 0, kept: 0, removed: 0 });
        handleDetectTransients.execute({
            type: 'detectTransients',
            payload: { clipId: 'c2', sensitivity: 0.9 },
        });
        expect(detectTransientsForClip).toHaveBeenCalledWith('c2', 0.9);
        expect(notifyUser).toHaveBeenCalledWith('Detected 0 transients (0 preserved)', 'success');
    });

    it('is not undoable and describes itself', () => {
        expect(handleDetectTransients.undoable).toBe(false);
        expect(handleDetectTransients.describe({} as never).label).toBe('Detect Transients');
    });
});

describe('handleQuantizeTransients', () => {
    beforeEach(() => vi.clearAllMocks());

    it.each([
        ['CLIP_NOT_FOUND', 'Clip not found'],
        ['CLIP_NOT_AUDIO', 'Quantize only works on audio clips'],
        ['NO_MARKERS', 'No transients detected — run Detect Transients first'],
    ] as const)('notifies the mapped error message on reason %s', (reason, message) => {
        vi.mocked(quantizeTransients).mockReturnValue({ ok: false, reason });
        handleQuantizeTransients.execute({ type: 'quantizeTransients', payload: { clipId: 'c1' } });
        expect(notifyUser).toHaveBeenCalledWith(message, 'error');
    });

    it('notifies the success summary with the moved count', () => {
        vi.mocked(quantizeTransients).mockReturnValue({ ok: true, moved: 7 });
        handleQuantizeTransients.execute({ type: 'quantizeTransients', payload: { clipId: 'c1' } });
        expect(quantizeTransients).toHaveBeenCalledWith('c1');
        expect(notifyUser).toHaveBeenCalledWith('Quantized 7 transients to the grid', 'success');
    });

    it('is undoable and describes itself', () => {
        expect(handleQuantizeTransients.undoable).toBe(true);
        expect(handleQuantizeTransients.describe({} as never).label).toBe('Quantize to Grid (Elastic Audio)');
    });
});
