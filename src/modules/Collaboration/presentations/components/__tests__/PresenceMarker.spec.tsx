import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PresenceMarker } from '../PresenceMarker';

describe('PresenceMarker', () => {
    it('should render', () => {
        render(<PresenceMarker name="Cue" color="#f00" left={4} variant="playhead" />);
        expect(screen.getByText('Cue')).toBeInTheDocument();
    });
});

describe('PresenceMarker — variant branching', () => {
    it('renders the name label for both playhead and cursor variants', () => {
        const { rerender } = render(<PresenceMarker name="Alice" color="#ff0000" left={10} variant="playhead" />);
        expect(screen.getByText('Alice')).toBeTruthy();

        rerender(<PresenceMarker name="Alice" color="#ff0000" left={10} variant="cursor" />);
        expect(screen.getByText('Alice')).toBeTruthy();
    });

    it('positions the label at left + offset (playhead offset=3, cursor offset=2)', () => {
        const { rerender } = render(<PresenceMarker name="X" color="#f00" left={10} variant="playhead" />);
        const labelPlayhead = screen.getByText('X');
        // playhead offset is 3: left + offset = 13px
        expect(labelPlayhead.getAttribute('style')).toContain('left: 13px');

        rerender(<PresenceMarker name="X" color="#f00" left={10} variant="cursor" />);
        const labelCursor = screen.getByText('X');
        // cursor offset is 2: left + offset = 12px
        expect(labelCursor.getAttribute('style')).toContain('left: 12px');
    });
});

describe('PresenceMarker — track dot conditional rendering', () => {
    it('does not render the track dot for playhead variant even when trackDotY is provided', () => {
        const { container } = render(
            <PresenceMarker name="X" color="#f00" left={10} variant="playhead" trackDotY={50} />
        );
        // The track dot is a small rounded-full div; playhead variant never renders it
        const dots = container.querySelectorAll('[style*="rounded"], .rounded-full');
        expect(dots.length).toBe(0);
    });

    it('does not render the track dot for cursor variant when trackDotY is null', () => {
        const { container } = render(
            <PresenceMarker name="X" color="#f00" left={10} variant="cursor" trackDotY={null} />
        );
        // Only the marker line + label should exist (2 elements), no track dot
        expect(container.querySelectorAll('[style*="background-color"]').length).toBeLessThanOrEqual(2);
    });

    it('renders the track dot for cursor variant when trackDotY is a number', () => {
        const { container } = render(
            <PresenceMarker name="X" color="#00ff00" left={20} variant="cursor" trackDotY={50} />
        );
        // The track dot has a computed top position based on trackDotY
        const dot = container.querySelector('[style*="top: 47px"]');
        expect(dot).toBeTruthy();
    });
});
