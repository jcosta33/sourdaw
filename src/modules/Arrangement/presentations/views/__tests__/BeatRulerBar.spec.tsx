import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { disableLooping } from '#/modules/Transport/useCases/setLooping';
import { seekPlayhead } from '#/modules/Transport/useCases/transportControls/seekPlayhead';

import { BeatRulerBar } from '../BeatRulerBar';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: {},
}));

vi.mock('#/modules/Transport/stores/transportStore', () => ({
    transportStore: {},
}));

vi.mock('#/modules/Transport/stores/playheadPositionRef', () => ({
    playheadPositionRef: { current: 0 },
}));

vi.mock('#/utils/DOM/AnimationScheduler', () => ({
    animationScheduler: {
        register: vi.fn(),
        unregister: vi.fn(),
    },
}));

vi.mock('#/modules/Transport/useCases/transportControls/seekPlayhead', () => ({
    seekPlayhead: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases/transportControls/setLoopRegion', () => ({
    setLoopRegion: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases/setLooping', () => ({
    disableLooping: vi.fn(),
}));

vi.mock('../TimelineChromeSurface', () => ({
    TimelineChromeSurface: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

describe('BeatRulerBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        const { container } = render(<BeatRulerBar />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render canvas element', () => {
        const { container } = render(<BeatRulerBar />);
        const canvas = container.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
    });

    it('should have correct cursor style', () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        expect(surface).toHaveClass('cursor-col-resize');
    });

    it('should have correct title attribute', () => {
        const { container } = render(<BeatRulerBar />);
        expect(container.firstChild).toHaveAttribute('title', expect.stringContaining('drag to set loop'));
    });

    it('should call seekPlayhead on mouse down', async () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        fireEvent.mouseDown(surface, { button: 0, clientX: 100 });
        expect(seekPlayhead).toHaveBeenCalled();
    });

    it('should handle double click to disable looping', async () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        fireEvent.doubleClick(surface);
        expect(disableLooping).toHaveBeenCalled();
    });

    it('should have select-none class', () => {
        const { container } = render(<BeatRulerBar />);
        expect(container.firstChild).toHaveClass('select-none');
    });

    it('should handle mouse move during drag', async () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        fireEvent.mouseDown(surface, { button: 0, clientX: 100 });
        fireEvent.mouseMove(surface, { clientX: 150, buttons: 1 });
        expect(seekPlayhead).toHaveBeenCalled();
    });
});
