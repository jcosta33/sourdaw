import { useRef } from 'react';

import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useTimelineGestures } from '../useTimelineGestures';

const mocks = vi.hoisted(() => ({
    zoomTimeline: vi.fn<(...args: unknown[]) => void>(),
    scrollTimeline: vi.fn<(...args: unknown[]) => void>(),
    setAutoScroll: vi.fn<(...args: unknown[]) => void>(),
    setScrollY: vi.fn<(...args: unknown[]) => void>(),
    setTimelineViewportHeight: vi.fn<(...args: unknown[]) => void>(),
    timelineViewStoreValue: { value: { scrollY: 0 } },
    trackStoreValue: { value: { tracks: [] as { height: number }[] } },
    transportStoreValue: { value: { isPlaying: false } },
}));

vi.mock('../../../stores/timelineViewStore', () => ({
    zoomTimeline: mocks.zoomTimeline,
    scrollTimeline: mocks.scrollTimeline,
    setAutoScroll: mocks.setAutoScroll,
    setScrollY: mocks.setScrollY,
    setTimelineViewportHeight: mocks.setTimelineViewportHeight,
    timelineViewStore: {
        get value() {
            return mocks.timelineViewStoreValue.value;
        },
    },
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return mocks.transportStoreValue.value;
        },
    },
}));

const TestComponent = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useTimelineGestures(canvasRef);
    return <canvas ref={canvasRef} data-testid="canvas" style={{ height: '500px' }} />;
};

describe('useTimelineGestures', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handles pinch zoom via wheel with ctrl/meta key', () => {
        const { getByTestId } = render(<TestComponent />);
        const canvas = getByTestId('canvas');

        act(() => {
            fireEvent.wheel(canvas, {
                deltaY: 5,
                ctrlKey: true,
                cancelable: true,
            });
        });

        expect(mocks.zoomTimeline).toHaveBeenCalled();
    });

    it('handles horizontal scroll via shift + wheel', () => {
        const { getByTestId } = render(<TestComponent />);
        const canvas = getByTestId('canvas');

        act(() => {
            fireEvent.wheel(canvas, {
                deltaX: 10,
                deltaY: 0,
                shiftKey: true,
                cancelable: true,
            });
        });

        expect(mocks.scrollTimeline).toHaveBeenCalledWith(10);
    });

    it('disables auto-scroll if scrolling while playing', () => {
        mocks.transportStoreValue.value = { isPlaying: true };
        const { getByTestId } = render(<TestComponent />);
        const canvas = getByTestId('canvas');

        act(() => {
            fireEvent.wheel(canvas, {
                deltaX: 10,
                deltaY: 0,
                shiftKey: true,
                cancelable: true,
            });
        });

        expect(mocks.setAutoScroll).toHaveBeenCalledWith(false);
    });

    it('handles vertical scroll via wheel', () => {
        mocks.timelineViewStoreValue.value = { scrollY: 100 };
        mocks.trackStoreValue.value = { tracks: [{ height: 1000 }] };

        const { getByTestId } = render(<TestComponent />);
        const canvas = getByTestId('canvas');
        // Manually set clientHeight since JSDOM might not calculate it from style
        Object.defineProperty(canvas, 'clientHeight', { value: 500 });

        act(() => {
            fireEvent.wheel(canvas, {
                deltaY: 50,
                cancelable: true,
            });
        });

        // The hook reports the real viewport height (canvas.clientHeight) to the
        // store first, then forwards the raw scroll target so setScrollY performs
        // the single authoritative clamp against that height — it no longer
        // pre-clamps against a separately computed ceiling or a 200px default.
        expect(mocks.setTimelineViewportHeight).toHaveBeenCalledWith(500);
        expect(mocks.setScrollY).toHaveBeenCalledWith(150);
    });
});
