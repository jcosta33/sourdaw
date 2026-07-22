import { describe, it, expect, vi } from 'vitest';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { scheduleAutomationOnParam } from '../scheduleAutomationOnParam';

function makeParam() {
    return {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
    };
}

function point(overrides: Partial<AutomationPoint> & { beat: number; value: number }): AutomationPoint {
    return { curve: 'linear', tension: 0, ...overrides };
}

// 120 bpm, no tempo changes → beatToSeconds(beat) === beat / 2.
function rampValues(param: ReturnType<typeof makeParam>): number[] {
    return param.linearRampToValueAtTime.mock.calls.map((call) => call[0] as number);
}

describe('scheduleAutomationOnParam — export region offset and latency compensation (M-038)', () => {
    /// Regression: points were scheduled at absolute beatToSeconds times, so
    /// a region export offset the automation by +regionStartSec against the
    /// audio it shapes, and latency-compensated tracks were offset by their
    /// compensation delay — while clip scheduling applies both corrections.
    it('shifts points into region-relative time and adds the compensation delay', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [
                point({ beat: 2, value: 0.2 }),
                point({ beat: 4, value: 0.8 }),
            ],
            10,
            120,
            [],
            2, // regionStartBeat — 1.0s at 120bpm
            0.25 // compensation delay
        );

        // Beat 4 -> (4 - 2) / 2 + 0.25 = 1.25s, ramping to 0.8.
        expect(param.linearRampToValueAtTime).toHaveBeenCalledWith(0.8, 1.25);
    });

    it('seeds the param with the value interpolated at the region start', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [
                point({ beat: 0, value: 0 }),
                point({ beat: 8, value: 1 }),
            ],
            10,
            120,
            [],
            4 // region starts mid-segment — value at beat 4 is 0.5
        );

        expect(param.setValueAtTime).toHaveBeenCalledWith(0.5, 0);
    });
});

describe('scheduleAutomationOnParam — step curve at the region boundary', () => {
    /// Regression (PR #616 review): a step hold emitted from a pre-region
    /// segment landed at clamped time 0 and overwrote the region-start
    /// seed — export held the lane's first value (0.1) where live holds
    /// the last (0.9).
    it('does not clobber the region-start seed with a pre-region step hold', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [
                point({ beat: 0, value: 0.1, curve: 'step' }),
                point({ beat: 1, value: 0.9 }),
            ],
            10,
            120,
            [],
            2 // region starts after the lane's last point — seed must hold 0.9
        );

        expect(param.setValueAtTime).toHaveBeenCalledWith(0.9, 0);
        expect(param.setValueAtTime).not.toHaveBeenCalledWith(0.1, 0);
    });
});

describe('scheduleAutomationOnParam — advanced curve shapes (M-039)', () => {
    /// Regression: 'smooth', 's-curve', 'stairs', and 'bezier' segments were
    /// silently flattened to linear in exports while playback renders them
    /// shaped (Automation's interpolateAutomationValue semantics).
    it('renders a smooth (Catmull-Rom) segment with its curved midpoint, not the linear one', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [
                point({ beat: 0, value: 0 }),
                point({ beat: 4, value: 1, curve: 'smooth' }),
                point({ beat: 8, value: 0 }),
            ],
            10,
            120,
            []
        );

        // The smooth segment [4, 8) sampled at its midpoint (beat 6, t=0.5)
        // yields the Catmull-Rom value 0.5625 (neighbours: beat-0 point at
        // 0, end duplicated at 0) — linear would be 0.5.
        const values = rampValues(param);
        expect(values).toContain(0.5625);
        expect(values).not.toContain(0.5);
    });

    it('renders a stairs segment quantized to its stair steps', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [
                point({ beat: 0, value: 0, curve: 'stairs', stairSteps: 4 }),
                point({ beat: 4, value: 1 }),
            ],
            10,
            120,
            []
        );

        const values = rampValues(param);
        // Stair-quantized: at t=0.5 the value is floor(2)/4 = 0.5 — but at
        // t=0.3 it must be 0.25, not the linear 0.3.
        expect(values).toContain(0.25);
        expect(values.some((value) => Math.abs(value - 0.3) < 1e-9)).toBe(false);
    });

    it('renders an s-curve segment with smoothstep easing', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [
                point({ beat: 0, value: 0, curve: 's-curve', tension: 1 }),
                point({ beat: 4, value: 1 }),
            ],
            10,
            120,
            []
        );

        // smoothstep at t=0.25 is 0.15625; with tension 1 the eased value
        // equals st itself — linear would be 0.25.
        const values = rampValues(param);
        expect(values).toContain(0.15625);
        expect(values).not.toContain(0.25);
    });

    it('renders a bezier segment through its control points', () => {
        const param = makeParam();
        scheduleAutomationOnParam(
            param as unknown as AudioParam,
            [
                point({ beat: 0, value: 0, curve: 'bezier', cp1: { x: 0.33, y: 0.9 }, cp2: { x: 0.66, y: 0.9 } }),
                point({ beat: 4, value: 1 }),
            ],
            10,
            120,
            []
        );

        // High control points pull the midpoint far above the linear 0.5.
        const values = rampValues(param);
        expect(values.some((value) => value > 0.7 && value < 0.95)).toBe(true);
    });
});
