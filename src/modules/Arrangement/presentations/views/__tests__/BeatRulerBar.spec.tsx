import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { disableLooping, seekPlayhead } from '#/modules/Transport/useCases';

import { BeatRulerBar } from '../BeatRulerBar';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: unknown) => defaultValue),
}));

vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: {},
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: {},
    playheadPositionRef: { current: 0 },
}));

vi.mock('#/utils/DOM/AnimationScheduler', () => ({
    animationScheduler: {
        register: vi.fn(),
        unregister: vi.fn(),
    },
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    seekPlayhead: vi.fn(),
    setLoopRegion: vi.fn(),
    disableLooping: vi.fn(),
}));

vi.mock('../TimelineChromeSurface', () => ({
    TimelineChromeSurface: ({ children, ...props }: import('react').ComponentProps<'div'>) => (
        <div {...props}>{children}</div>
    ),
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

    it('should call seekPlayhead on mouse down', () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        fireEvent.mouseDown(surface, { button: 0, clientX: 100 });
        expect(seekPlayhead).toHaveBeenCalled();
    });

    it('should handle double click to disable looping', () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        fireEvent.doubleClick(surface);
        expect(disableLooping).toHaveBeenCalled();
    });

    it('should have select-none class', () => {
        const { container } = render(<BeatRulerBar />);
        expect(container.firstChild).toHaveClass('select-none');
    });

    it('should handle mouse move during drag', () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        fireEvent.mouseDown(surface, { button: 0, clientX: 100 });
        fireEvent.mouseMove(surface, { clientX: 150, buttons: 1 });
        expect(seekPlayhead).toHaveBeenCalled();
    });
});
