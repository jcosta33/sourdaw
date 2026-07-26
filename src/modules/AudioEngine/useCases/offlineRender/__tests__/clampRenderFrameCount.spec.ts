import { describe, expect, it, vi } from 'vitest';

import { clampRenderFrameCount } from '../clampRenderFrameCount';
import { MAX_OFFLINE_FRAMES } from '../constants';

const SAMPLE_RATE = 48_000;

describe('clampRenderFrameCount', () => {
    it('returns the exact requested frame count when the timeline fits', () => {
        const onWarning = vi.fn();

        const frames = clampRenderFrameCount({ durationSeconds: 12.5, sampleRate: SAMPLE_RATE, onWarning });

        expect(frames).toBe(600_000);
        expect(onWarning).not.toHaveBeenCalled();
    });

    it('rounds a fractional frame boundary up so the final partial quantum is rendered', () => {
        expect(clampRenderFrameCount({ durationSeconds: 1.000_01, sampleRate: SAMPLE_RATE })).toBe(48_001);
    });

    it('caps an over-long render and reports how much timeline was dropped', () => {
        const onWarning = vi.fn();
        // ~9.3 h at 48 kHz — half again over the renderer's frame ceiling.
        const durationSeconds = (MAX_OFFLINE_FRAMES * 1.5) / SAMPLE_RATE;

        const frames = clampRenderFrameCount({ durationSeconds, sampleRate: SAMPLE_RATE, onWarning });

        expect(frames).toBe(MAX_OFFLINE_FRAMES);
        expect(onWarning).toHaveBeenCalledTimes(1);
        const message = onWarning.mock.calls[0]![0] as string;
        expect(message).toContain('truncated to 6.21 h');
        expect(message).toContain('9.32 h was requested');
    });

    it('still caps the frame count when no warning sink is supplied', () => {
        const durationSeconds = (MAX_OFFLINE_FRAMES * 2) / SAMPLE_RATE;

        expect(clampRenderFrameCount({ durationSeconds, sampleRate: SAMPLE_RATE })).toBe(MAX_OFFLINE_FRAMES);
    });
});
