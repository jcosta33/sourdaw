import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';
import { handleDetectTransients } from '../handleDetectTransients';

const mocks = vi.hoisted(() => ({ detect: vi.fn(), notice: vi.fn() }));
vi.mock('#/modules/ElasticAudio/useCases', () => ({ detectTransientsForClip: mocks.detect }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notice }));

describe('Arrangement Detect owns async admission and notification', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        preferencesStore.trySet(defaultPreferences);
    });
    it.each([undefined, 0.9])('awaits failure and uses explicit or persisted sensitivity %s', async (sensitivity) => {
        preferencesStore.trySet({ ...defaultPreferences, elasticTransientSensitivity: 0.82 });
        let fail: ((value: { status: 'failed'; code: 'analysis-failed' }) => void) | undefined;
        mocks.detect.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    fail = resolve;
                })
        );
        const action = { type: 'detectTransients' as const, payload: { clipId: 'clip-1', sensitivity } };
        handleDetectTransients.describe(action);
        const result = handleDetectTransients.execute(action);
        expect(mocks.notice).not.toHaveBeenCalled();
        expect(mocks.detect).toHaveBeenCalledWith('clip-1', sensitivity ?? 0.82, undefined);
        fail?.({ status: 'failed', code: 'analysis-failed' });
        expect(await result).toEqual({ status: 'conflict', reason: 'Transient detection failed: analysis-failed' });
        expect(mocks.notice).toHaveBeenCalledWith('Transient detection failed: analysis-failed', 'error');
        expect(handleDetectTransients.undoable).toBe(true);
    });
});
