import { describe, it, expect, vi, afterEach } from 'vitest';

import { type Step } from '../../models/ToasterKit';
import { getSequencerPlaybackState } from '../getSequencerPlaybackState';
import { shouldTriggerSequencerStep } from '../shouldTriggerSequencerStep';

function activeStep(overrides: Partial<Step> = {}): Step {
    return {
        active: true,
        velocity: 0.8,
        probability: 1,
        microTiming: 0,
        retriggerCount: 0,
        condition: 'always',
        paramLocks: {},
        ...overrides,
    };
}

describe('shouldTriggerSequencerStep', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('never fires an inactive step, regardless of its condition', () => {
        const step = activeStep({ active: false, condition: 'fill' });

        expect(shouldTriggerSequencerStep({ deviceId: 'dev-inactive', step, loopIndex: 0 })).toBe(false);
    });

    it('fires an active always-condition step', () => {
        const step = activeStep({ condition: 'always' });

        expect(shouldTriggerSequencerStep({ deviceId: 'dev-always', step, loopIndex: 5 })).toBe(true);
    });

    it('fires a fill-condition step only while fill is active for that device', () => {
        const deviceId = 'dev-fill';
        const step = activeStep({ condition: 'fill' });

        expect(shouldTriggerSequencerStep({ deviceId, step, loopIndex: 0 })).toBe(false);

        getSequencerPlaybackState(deviceId).fillActive = true;

        expect(shouldTriggerSequencerStep({ deviceId, step, loopIndex: 0 })).toBe(true);
    });

    it('fires a not-fill-condition step only while fill is inactive for that device', () => {
        const deviceId = 'dev-not-fill';
        const step = activeStep({ condition: 'not-fill' });

        expect(shouldTriggerSequencerStep({ deviceId, step, loopIndex: 0 })).toBe(true);

        getSequencerPlaybackState(deviceId).fillActive = true;

        expect(shouldTriggerSequencerStep({ deviceId, step, loopIndex: 0 })).toBe(false);
    });

    it('defers fill and not-fill decisions for audio-thread dispatch', () => {
        const deviceId = 'dev-deferred-fill';

        expect(
            shouldTriggerSequencerStep({
                deviceId,
                step: activeStep({ condition: 'fill' }),
                loopIndex: 0,
                deferFillCondition: true,
            })
        ).toBe(true);
        getSequencerPlaybackState(deviceId).fillActive = true;
        expect(
            shouldTriggerSequencerStep({
                deviceId,
                step: activeStep({ condition: 'not-fill' }),
                loopIndex: 0,
                deferFillCondition: true,
            })
        ).toBe(true);
    });

    it('fires a first-condition step only on the first loop pass', () => {
        const step = activeStep({ condition: 'first' });

        expect(shouldTriggerSequencerStep({ deviceId: 'dev-first', step, loopIndex: 0 })).toBe(true);
        expect(shouldTriggerSequencerStep({ deviceId: 'dev-first', step, loopIndex: 1 })).toBe(false);
    });

    it('fires a not-first-condition step on every pass after the first', () => {
        const step = activeStep({ condition: 'not-first' });

        expect(shouldTriggerSequencerStep({ deviceId: 'dev-not-first', step, loopIndex: 0 })).toBe(false);
        expect(shouldTriggerSequencerStep({ deviceId: 'dev-not-first', step, loopIndex: 2 })).toBe(true);
    });

    it('rolls probability against Math.random for a sub-1 probability step', () => {
        const step = activeStep({ probability: 0.5 });
        const randomSpy = vi.spyOn(Math, 'random');

        randomSpy.mockReturnValueOnce(0.9); // 0.9 > 0.5 -> skip
        expect(shouldTriggerSequencerStep({ deviceId: 'dev-prob', step, loopIndex: 0 })).toBe(false);

        randomSpy.mockReturnValueOnce(0.1); // 0.1 <= 0.5 -> fire
        expect(shouldTriggerSequencerStep({ deviceId: 'dev-prob', step, loopIndex: 0 })).toBe(true);
    });

    it('skips the probability roll entirely at probability 1', () => {
        const step = activeStep({ probability: 1 });
        const randomSpy = vi.spyOn(Math, 'random');

        expect(shouldTriggerSequencerStep({ deviceId: 'dev-prob-1', step, loopIndex: 0 })).toBe(true);
        expect(randomSpy).not.toHaveBeenCalled();
    });
});
