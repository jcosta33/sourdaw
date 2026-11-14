import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { timelineViewStore } from '../../../stores/timelineViewStore';
import { trackStore } from '../../../stores/trackStore';
import { TimelineMinimap } from '../TimelineMinimap';

const PIXELS_PER_BEAT = 10;
const STEP_BEATS = 4;

function setScrollBeats(beats: number): void {
    const state = timelineViewStore.value!;
    timelineViewStore.set({ ...state, pixelsPerBeat: PIXELS_PER_BEAT, scrollX: beats * PIXELS_PER_BEAT });
}

describe('TimelineMinimap keyboard steps that arrive faster than a re-render', () => {
    beforeEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null });
        act(() => setScrollBeats(0));
    });

    afterEach(() => {
        cleanup();
    });

    it('applies every ArrowRight press fired before the next render', async () => {
        render(<TimelineMinimap />);
        const slider = screen.getByRole('slider');

        // Dispatch without a React flush between events: each handler runs against the render-time closure.
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

        expect(timelineViewStore.value?.scrollX).toBe(3 * STEP_BEATS * PIXELS_PER_BEAT);
        await waitFor(() =>
            expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', String(3 * STEP_BEATS))
        );
    });

    it('applies every ArrowLeft press fired before the next render', () => {
        act(() => setScrollBeats(20));
        render(<TimelineMinimap />);
        const slider = screen.getByRole('slider');

        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));

        expect(timelineViewStore.value?.scrollX).toBe((20 - 3 * STEP_BEATS) * PIXELS_PER_BEAT);
    });
});
