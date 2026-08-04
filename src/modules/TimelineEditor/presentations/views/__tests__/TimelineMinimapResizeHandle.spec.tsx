import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    TIMELINE_MINIMAP_MIN_HEIGHT,
    TIMELINE_MINIMAP_MAX_HEIGHT,
} from '#/utils/TimelineMinimap/timelineMinimapHeight';

import { TimelineMinimapResizeHandle } from '../TimelineMinimapResizeHandle';

function renderHandle(overrides: Record<string, unknown> = {}) {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
        <TimelineMinimapResizeHandle
            height={80}
            persistedHeight={80}
            onPreview={onPreview}
            onCommit={onCommit}
            onCancel={onCancel}
            {...overrides}
        />
    );
    return { onPreview, onCommit, onCancel };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('TimelineMinimapResizeHandle — slider structure', () => {
    it('renders with aria-label "Resize timeline minimap"', () => {
        renderHandle();
        expect(screen.getByLabelText('Resize timeline minimap')).toBeInTheDocument();
    });

    it('aria-valuemin equals TIMELINE_MINIMAP_MIN_HEIGHT', () => {
        renderHandle();
        expect(screen.getByLabelText('Resize timeline minimap')).toHaveAttribute(
            'aria-valuemin',
            String(TIMELINE_MINIMAP_MIN_HEIGHT)
        );
    });

    it('aria-valuemax equals TIMELINE_MINIMAP_MAX_HEIGHT', () => {
        renderHandle();
        expect(screen.getByLabelText('Resize timeline minimap')).toHaveAttribute(
            'aria-valuemax',
            String(TIMELINE_MINIMAP_MAX_HEIGHT)
        );
    });

    it('aria-valuenow reflects normalized height', () => {
        renderHandle({ height: 100 });
        expect(screen.getByLabelText('Resize timeline minimap')).toHaveAttribute('aria-valuenow', '100');
    });

    it('clamps non-normal height to valid range in aria-valuenow', () => {
        renderHandle({ height: 9999 });
        const valuenow = Number(screen.getByLabelText('Resize timeline minimap').getAttribute('aria-valuenow'));
        expect(valuenow).toBeLessThanOrEqual(TIMELINE_MINIMAP_MAX_HEIGHT);
    });
});

describe('TimelineMinimapResizeHandle — keyboard ArrowUp', () => {
    it('ArrowUp commits height + 4', () => {
        const { onCommit } = renderHandle({ height: 80 });
        fireEvent.keyDown(screen.getByLabelText('Resize timeline minimap'), { key: 'ArrowUp' });
        expect(onCommit).toHaveBeenCalledWith(84);
    });

    it('Shift+ArrowUp commits height + 1', () => {
        const { onCommit } = renderHandle({ height: 80 });
        fireEvent.keyDown(screen.getByLabelText('Resize timeline minimap'), { key: 'ArrowUp', shiftKey: true });
        expect(onCommit).toHaveBeenCalledWith(81);
    });

    it('ArrowUp clamps to MAX', () => {
        const { onCommit } = renderHandle({ height: TIMELINE_MINIMAP_MAX_HEIGHT - 2 });
        fireEvent.keyDown(screen.getByLabelText('Resize timeline minimap'), { key: 'ArrowUp' });
        expect(onCommit).toHaveBeenCalledWith(TIMELINE_MINIMAP_MAX_HEIGHT);
    });
});

describe('TimelineMinimapResizeHandle — keyboard ArrowDown', () => {
    it('ArrowDown commits height - 4', () => {
        const { onCommit } = renderHandle({ height: 80 });
        fireEvent.keyDown(screen.getByLabelText('Resize timeline minimap'), { key: 'ArrowDown' });
        expect(onCommit).toHaveBeenCalledWith(76);
    });

    it('ArrowDown clamps to MIN', () => {
        const { onCommit } = renderHandle({ height: TIMELINE_MINIMAP_MIN_HEIGHT + 2 });
        fireEvent.keyDown(screen.getByLabelText('Resize timeline minimap'), { key: 'ArrowDown' });
        expect(onCommit).toHaveBeenCalledWith(TIMELINE_MINIMAP_MIN_HEIGHT);
    });
});

describe('TimelineMinimapResizeHandle — keyboard Home/End', () => {
    it('Home commits MIN height', () => {
        const { onCommit } = renderHandle({ height: 80 });
        fireEvent.keyDown(screen.getByLabelText('Resize timeline minimap'), { key: 'Home' });
        expect(onCommit).toHaveBeenCalledWith(TIMELINE_MINIMAP_MIN_HEIGHT);
    });

    it('End commits MAX height', () => {
        const { onCommit } = renderHandle({ height: 80 });
        fireEvent.keyDown(screen.getByLabelText('Resize timeline minimap'), { key: 'End' });
        expect(onCommit).toHaveBeenCalledWith(TIMELINE_MINIMAP_MAX_HEIGHT);
    });
});

describe('TimelineMinimapResizeHandle — keyboard no-op', () => {
    it('does not commit when value does not change (already at MIN, ArrowDown)', () => {
        const { onCommit } = renderHandle({ height: TIMELINE_MINIMAP_MIN_HEIGHT });
        fireEvent.keyDown(screen.getByLabelText('Resize timeline minimap'), { key: 'ArrowDown' });
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('ignores non-arrow keys', () => {
        const { onCommit } = renderHandle({ height: 80 });
        fireEvent.keyDown(screen.getByLabelText('Resize timeline minimap'), { key: 'Enter' });
        expect(onCommit).not.toHaveBeenCalled();
    });
});
