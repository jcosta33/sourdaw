import { createElement, type HTMLAttributes } from 'react';

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TimelineMinimap } from '../TimelineMinimap';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, fallback: unknown) => fallback),
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { value: { isPlaying: false } },
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: { value: null, subscribe: vi.fn(() => vi.fn()), set: vi.fn() },
}));

vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: { value: null, subscribe: vi.fn(() => vi.fn()), set: vi.fn() },
}));

vi.mock('../../../useCases/setTimelineMinimapScrollX', () => ({
    setTimelineMinimapScrollX: vi.fn(),
}));

vi.mock('../../../useCases/setTimelineMinimapAutoScroll', () => ({
    setTimelineMinimapAutoScroll: vi.fn(),
}));

vi.mock('../TimelineChromeSurface', () => ({
    TimelineChromeSurface: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) =>
        createElement('div', props, children),
}));

class MockResizeObserver {
    constructor(_callback: ResizeObserverCallback) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}

describe('timeline minimap height contract', () => {
    it.each([
        { input: Number.NaN, expected: 28 },
        { input: Number.POSITIVE_INFINITY, expected: 28 },
        { input: 12, expected: 28 },
        { input: 51.6, expected: 52 },
        { input: 220, expected: 160 },
    ])('normalizes $input to $expected CSS pixels', ({ input, expected }) => {
        global.ResizeObserver = MockResizeObserver;

        const { container } = render(createElement(TimelineMinimap, { height: input }));

        expect(container.firstChild).toHaveStyle({ height: `${expected}px` });
        expect(container.querySelector('canvas')).toHaveStyle({ height: `${expected}px` });
    });
});
