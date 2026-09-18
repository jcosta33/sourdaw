/**
 * What the panel's status readout is allowed to claim (#4204).
 *
 * Both wrong answers cost the musician the same way. Claiming Ready over a
 * device with no sampler behind it means every knob moves nothing and the panel
 * says everything is fine — the state a readout believing the instance entry
 * lands in, because a panel mount seeds one whether or not a native instance
 * was ever created. Claiming unavailable over a working one sends the musician
 * looking for a fault in an instrument that plays.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isCrumbsNativeAvailable } from '../../../repositories/crumbsBridge/isCrumbsNativeAvailable';
import { readCrumbsEngineReadiness } from '../readCrumbsEngineReadiness';

vi.mock('../../../repositories/crumbsBridge/isCrumbsNativeAvailable', () => ({
    isCrumbsNativeAvailable: vi.fn(() => true),
}));

const nativeAvailableMock = vi.mocked(isCrumbsNativeAvailable);

beforeEach(() => {
    nativeAvailableMock.mockReset();
    nativeAvailableMock.mockReturnValue(true);
});

describe('readCrumbsEngineReadiness on a native build', () => {
    it('reads a bound instance as ready, attached or still dormant', () => {
        expect(
            readCrumbsEngineReadiness({ attachedNatively: false, hasInstanceState: true, nativeLifecycle: 'bound' })
        ).toBe(true);
        expect(
            readCrumbsEngineReadiness({ attachedNatively: true, hasInstanceState: true, nativeLifecycle: 'bound' })
        ).toBe(true);
    });

    // The case the store-presence reading got wrong: the create was refused and
    // its instance state rolled back, and then a mount put the entry straight
    // back. Instance state is therefore no evidence at all here.
    it('reads a failed create as unavailable however much instance state exists', () => {
        expect(
            readCrumbsEngineReadiness({ attachedNatively: false, hasInstanceState: true, nativeLifecycle: 'failed' })
        ).toBe(false);
    });

    it('decides nothing while the create is in flight or unanswered', () => {
        expect(
            readCrumbsEngineReadiness({ attachedNatively: false, hasInstanceState: true, nativeLifecycle: 'creating' })
        ).toBeNull();
        expect(
            readCrumbsEngineReadiness({
                attachedNatively: false,
                hasInstanceState: true,
                nativeLifecycle: undefined,
            })
        ).toBeNull();
    });

    // An instance the engine reports rendering outranks every other witness:
    // whatever this process last recorded about the create, the sampler is
    // audible now.
    it('lets the attachment mirror settle it', () => {
        expect(
            readCrumbsEngineReadiness({ attachedNatively: true, hasInstanceState: false, nativeLifecycle: 'failed' })
        ).toBe(true);
        expect(
            readCrumbsEngineReadiness({ attachedNatively: true, hasInstanceState: false, nativeLifecycle: undefined })
        ).toBe(true);
    });
});

describe('readCrumbsEngineReadiness on a build with no native runtime', () => {
    beforeEach(() => {
        nativeAvailableMock.mockReturnValue(false);
    });

    // No native instance is in question: the worklet node on the strip takes
    // the write, and the entry is what says its state exists. A native
    // lifecycle cannot be recorded here, and is ignored if one somehow is.
    it('answers from instance state alone', () => {
        expect(
            readCrumbsEngineReadiness({ attachedNatively: false, hasInstanceState: true, nativeLifecycle: undefined })
        ).toBe(true);
        expect(
            readCrumbsEngineReadiness({ attachedNatively: false, hasInstanceState: true, nativeLifecycle: 'failed' })
        ).toBe(true);
    });

    it('decides nothing in the frames before the mount ensure lands', () => {
        expect(
            readCrumbsEngineReadiness({ attachedNatively: false, hasInstanceState: false, nativeLifecycle: undefined })
        ).toBeNull();
    });
});
