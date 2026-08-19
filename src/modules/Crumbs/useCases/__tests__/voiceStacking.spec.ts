import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { createHandler } from '#/utils/createHandler';

import { crumbsStore, defaultCrumbsState } from '../../stores/crumbsStore';
import { updateVoiceStack } from '../voiceStacking';

const mocks = vi.hoisted(() => ({
    updateDeviceParam: vi.fn(),
    setCrumbsParamThrottled: vi.fn(),
    setCrumbsParamImmediate: vi.fn(),
    cancelCrumbsParamPreview: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
    clampDeviceParamWrite: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    resolveEligibleDeviceWriteTarget: mocks.resolveEligibleDeviceWriteTarget,
    clampDeviceParamWrite: mocks.clampDeviceParamWrite,
}));

vi.mock('../crumbsParamBridge/setCrumbsParamThrottled', () => ({
    setCrumbsParamThrottled: mocks.setCrumbsParamThrottled,
}));

vi.mock('../crumbsParamBridge/setCrumbsParamImmediate', () => ({
    setCrumbsParamImmediate: mocks.setCrumbsParamImmediate,
}));

vi.mock('../crumbsParamBridge/cancelCrumbsParamPreview', () => ({
    cancelCrumbsParamPreview: mocks.cancelCrumbsParamPreview,
}));

const INSTANCE = 'inst-A';
const TRACK = 'track-A';

/**
 * The voice-stack controls used to address the native `CrumbsInstance` only.
 *
 * `setCrumbsParamThrottled` reaches the sample-acquisition and disk-streaming
 * engine behind the `set_crumbs_param` native command; the `crumbs-processor`
 * worklet in the track strip is a different object and received nothing. So the
 * assertions below are about **which** engine door each field goes through, and
 * a count of native pushes is deliberately not one of them — the old version of
 * this file asserted exactly that and passed throughout the defect's life.
 *
 * The behavioural end of the same claim is
 * `AudioEngine/engine/__tests__/panelReachesTheEngine.spec.tsx`, which drives
 * the real panel and reads the value off a real strip node.
 */
describe('updateVoiceStack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: TRACK,
            deviceId: INSTANCE,
        });
        mocks.clampDeviceParamWrite.mockImplementation(({ value }: { value: number }) => value);
        crumbsStore.set({ [INSTANCE]: { ...defaultCrumbsState } });
        registerHandlerMap({
            setDeviceParameter: createHandler<'setDeviceParameter'>({
                undoable: false,
                execute: () => {},
                describe: () => ({ label: 'noop', inverseAction: null }),
            }),
        });
    });

    afterEach(() => {
        clearHandlerRegistry();
        crumbsStore.set({});
    });

    it('sends a transient voice count to the worklet, not only to the native instance', () => {
        updateVoiceStack(INSTANCE, { stackCount: 4 }, true);

        expect(mocks.updateDeviceParam).toHaveBeenCalledWith(TRACK, INSTANCE, 'stackCount', 4);
    });

    it('sends a transient detune spread to the worklet', () => {
        updateVoiceStack(INSTANCE, { detuneSpread: 37.5 }, true);

        expect(mocks.updateDeviceParam).toHaveBeenCalledWith(TRACK, INSTANCE, 'detuneSpread', 37.5);
    });

    it('sends a transient stereo spread to the worklet', () => {
        updateVoiceStack(INSTANCE, { stackSpread: 0.65 }, true);

        expect(mocks.updateDeviceParam).toHaveBeenCalledWith(TRACK, INSTANCE, 'stackSpread', 0.65);
    });

    it('sends each field of a combined update as its own parameter write', () => {
        updateVoiceStack(INSTANCE, { stackCount: 2, detuneSpread: 12, stackSpread: 0.2 }, true);

        expect(mocks.updateDeviceParam.mock.calls.map((call) => [call[2], call[3]])).toEqual([
            ['stackCount', 2],
            ['detuneSpread', 12],
            ['stackSpread', 0.2],
        ]);
    });

    it('moves the session store so the controlled panel does not snap back mid-drag', () => {
        updateVoiceStack(INSTANCE, { stackCount: 6, stackSpread: 0.4 }, true);

        expect(crumbsStore.value?.[INSTANCE]?.voiceStack.stackCount).toBe(6);
        expect(crumbsStore.value?.[INSTANCE]?.voiceStack.stackSpread).toBe(0.4);
        // Untouched field is left alone rather than reset to its default.
        expect(crumbsStore.value?.[INSTANCE]?.voiceStack.detuneSpread).toBe(defaultCrumbsState.voiceStack.detuneSpread);
    });

    it('does not reach the worklet for a device the write boundary rejects', () => {
        // A panel left open across a device delete must not resurrect it, and a
        // device id owned by no track has no strip to address.
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({ status: 'missing' });

        updateVoiceStack(INSTANCE, { stackCount: 4 }, true);

        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('previews on a transient move and commits on release, so a drag is one edit', () => {
        updateVoiceStack(INSTANCE, { stackCount: 4 }, true);
        expect(mocks.setCrumbsParamImmediate).not.toHaveBeenCalled();

        updateVoiceStack(INSTANCE, { stackCount: 4 }, false);
        expect(mocks.cancelCrumbsParamPreview).toHaveBeenCalledWith(INSTANCE, 'stackCount');
        expect(mocks.setCrumbsParamImmediate).toHaveBeenCalledWith(INSTANCE, 'stackCount', 4);
    });

    it('writes nothing for an empty update', () => {
        updateVoiceStack(INSTANCE, {}, true);

        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.setCrumbsParamThrottled).not.toHaveBeenCalled();
    });
});
