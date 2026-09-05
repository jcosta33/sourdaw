import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setCrumbsParamWithAudio } from '../setCrumbsParamWithAudio';

const userDispatch = vi.hoisted(() => vi.fn((): Promise<void> => Promise.resolve()));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: userDispatch,
    executeAppAction: vi.fn(),
    pushUndoEntry: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    resolveEligibleDeviceWriteTarget: vi.fn(() => ({ status: 'ineligible' as const })),
}));

vi.mock('../../repositories/crumbsBridge/setCrumbsParam', () => ({
    setCrumbsParam: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../stores/crumbsStore', () => ({
    applyCrumbsParamValue: vi.fn(),
    beginCrumbsParamPreview: vi.fn(),
    endCrumbsParamPreview: vi.fn(),
}));

describe('setCrumbsParamWithAudio dispatch seam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('commits the settled knob value through the user dispatch wrapper', () => {
        setCrumbsParamWithAudio('crumbs-1', 'filterCutoff', 0.75, false);

        expect(userDispatch).toHaveBeenCalledExactlyOnceWith({
            type: 'setDeviceParameter',
            payload: { deviceId: 'crumbs-1', paramId: 'filterCutoff', value: 0.75 },
        });
    });

    it('keeps the transient half off the dispatch path', () => {
        setCrumbsParamWithAudio('crumbs-1', 'filterCutoff', 0.4, true);

        expect(userDispatch).not.toHaveBeenCalled();
    });
});
