import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SliceOverlay } from '../SliceOverlay';

import type { SliceMarker } from '../../../models/CrumbsTypes';

function makeMarker(overrides: Partial<SliceMarker> = {}): SliceMarker {
    return { id: 'm1', label: 'A', framePosition: 100, ...overrides };
}

function renderOverlay(overrides: Record<string, unknown> = {}) {
    const onMarkerDrag = vi.fn();
    const onSelectSlice = vi.fn();
    render(
        <SliceOverlay
            markers={[makeMarker(), makeMarker({ id: 'm2', label: 'B', framePosition: 200 })]}
            totalFrames={400}
            activeSliceIndex={0}
            height={80}
            onMarkerDrag={onMarkerDrag}
            onSelectSlice={onSelectSlice}
            {...overrides}
        />
    );
    return { onMarkerDrag, onSelectSlice };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('SliceOverlay — empty state', () => {
    it('renders an empty div when totalFrames is 0', () => {
        const { container } = render(
            <SliceOverlay
                markers={[]}
                totalFrames={0}
                activeSliceIndex={-1}
                height={80}
                onMarkerDrag={vi.fn()}
                onSelectSlice={vi.fn()}
            />
        );
        // Should render a bare div (no markers)
        expect(container.querySelectorAll('[role="slider"]')).toHaveLength(0);
    });
});

describe('SliceOverlay — slider rendering', () => {
    it('renders a slider for each marker with its label', () => {
        renderOverlay();
        expect(screen.getByLabelText('Slice marker A')).toBeInTheDocument();
        expect(screen.getByLabelText('Slice marker B')).toBeInTheDocument();
    });

    it('aria-valuenow reflects frame position', () => {
        renderOverlay();
        expect(screen.getByLabelText('Slice marker A')).toHaveAttribute('aria-valuenow', '100');
    });

    it('aria-valuemax reflects totalFrames', () => {
        renderOverlay();
        expect(screen.getByLabelText('Slice marker A')).toHaveAttribute('aria-valuemax', '400');
    });

    it('aria-valuemin is 0', () => {
        renderOverlay();
        expect(screen.getByLabelText('Slice marker A')).toHaveAttribute('aria-valuemin', '0');
    });
});

describe('SliceOverlay — keyboard nudge', () => {
    it('ArrowRight increases frame by 1 and calls onMarkerDrag + onSelectSlice', () => {
        const { onMarkerDrag, onSelectSlice } = renderOverlay();
        fireEvent.keyDown(screen.getByLabelText('Slice marker A'), { key: 'ArrowRight' });
        expect(onMarkerDrag).toHaveBeenCalledWith('m1', 101);
        expect(onSelectSlice).toHaveBeenCalledWith(0);
    });

    it('ArrowLeft decreases frame by 1 and calls onMarkerDrag + onSelectSlice', () => {
        const { onMarkerDrag, onSelectSlice } = renderOverlay();
        fireEvent.keyDown(screen.getByLabelText('Slice marker A'), { key: 'ArrowLeft' });
        expect(onMarkerDrag).toHaveBeenCalledWith('m1', 99);
        expect(onSelectSlice).toHaveBeenCalledWith(0);
    });

    it('ArrowLeft clamps to 0', () => {
        render(
            <SliceOverlay
                markers={[makeMarker({ framePosition: 0 })]}
                totalFrames={400}
                activeSliceIndex={0}
                height={80}
                onMarkerDrag={vi.fn()}
                onSelectSlice={vi.fn()}
            />
        );
        const onMarkerDrag = vi.fn();
        // Re-render with the mock
        render(
            <SliceOverlay
                markers={[makeMarker({ framePosition: 0 })]}
                totalFrames={400}
                activeSliceIndex={0}
                height={80}
                onMarkerDrag={onMarkerDrag}
                onSelectSlice={vi.fn()}
            />
        );
        fireEvent.keyDown(screen.getAllByLabelText('Slice marker A')[1]!, { key: 'ArrowLeft' });
        expect(onMarkerDrag).toHaveBeenCalledWith('m1', 0);
    });

    it('ArrowRight clamps to totalFrames', () => {
        const { onMarkerDrag } = renderOverlay({ markers: [makeMarker({ framePosition: 400 })] });
        fireEvent.keyDown(screen.getByLabelText('Slice marker A'), { key: 'ArrowRight' });
        expect(onMarkerDrag).toHaveBeenCalledWith('m1', 400);
    });

    it('Enter/Space calls onSelectSlice but not onMarkerDrag', () => {
        const { onMarkerDrag, onSelectSlice } = renderOverlay();
        fireEvent.keyDown(screen.getByLabelText('Slice marker A'), { key: 'Enter' });
        expect(onSelectSlice).toHaveBeenCalledWith(0);
        expect(onMarkerDrag).not.toHaveBeenCalled();
    });

    it('Space key calls onSelectSlice but not onMarkerDrag', () => {
        const { onMarkerDrag, onSelectSlice } = renderOverlay();
        fireEvent.keyDown(screen.getByLabelText('Slice marker A'), { key: ' ' });
        expect(onSelectSlice).toHaveBeenCalledWith(0);
        expect(onMarkerDrag).not.toHaveBeenCalled();
    });
});
