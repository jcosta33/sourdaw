import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { PresenceMarker } from '../PresenceMarker';

describe('PresenceMarker — label rendering', () => {
    it('renders the name for playhead variant', () => {
        render(<PresenceMarker name="Alice" color="#ff0000" left={10} variant="playhead" />);
        expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    it('renders the name for cursor variant', () => {
        render(<PresenceMarker name="Bob" color="#00ff00" left={20} variant="cursor" />);
        expect(screen.getByText('Bob')).toBeInTheDocument();
    });
});

describe('PresenceMarker — line rendering by variant', () => {
    it('sets dashed background for playhead', () => {
        const { container } = render(<PresenceMarker name="A" color="#f00" left={10} variant="playhead" />);
        const line = container.firstChild as HTMLElement;
        expect(line.style.backgroundImage).toContain('repeating-linear-gradient');
    });

    it('sets solid backgroundColor for cursor', () => {
        const { container } = render(<PresenceMarker name="A" color="#0f0" left={10} variant="cursor" />);
        const line = container.firstChild as HTMLElement;
        expect(line.style.backgroundColor).toBe('rgb(0, 255, 0)');
        expect(line.style.backgroundImage).toBe('');
    });

    it('playhead opacity is 0.6', () => {
        const { container } = render(<PresenceMarker name="A" color="#f00" left={10} variant="playhead" />);
        const line = container.firstChild as HTMLElement;
        expect(line.style.opacity).toBe('0.6');
    });

    it('cursor opacity is 0.7', () => {
        const { container } = render(<PresenceMarker name="A" color="#0f0" left={10} variant="cursor" />);
        const line = container.firstChild as HTMLElement;
        expect(line.style.opacity).toBe('0.7');
    });
});

describe('PresenceMarker — label positioning by variant', () => {
    it('playhead label edge is bottom (bottom-1 class)', () => {
        render(<PresenceMarker name="A" color="#f00" left={10} variant="playhead" />);
        expect(screen.getByText('A').className).toContain('bottom-1');
    });

    it('cursor label edge is top (top-0 class)', () => {
        render(<PresenceMarker name="A" color="#0f0" left={10} variant="cursor" />);
        expect(screen.getByText('A').className).toContain('top-0');
    });
});

describe('PresenceMarker — track dot', () => {
    it('renders a track dot for cursor with trackDotY', () => {
        const { container } = render(
            <PresenceMarker name="A" color="#0f0" left={10} variant="cursor" trackDotY={50} />
        );
        // The track dot is a div with rounded-full class
        const dot = container.querySelector('.rounded-full') as HTMLElement | null;
        expect(dot).not.toBeNull();
        expect(dot?.style.top).toBe('47px');
    });

    it('does not render a track dot for playhead', () => {
        const { container } = render(
            <PresenceMarker name="A" color="#0f0" left={10} variant="playhead" trackDotY={50} />
        );
        const dot = container.querySelector('.rounded-full');
        expect(dot).toBeNull();
    });

    it('does not render a track dot for cursor without trackDotY', () => {
        const { container } = render(
            <PresenceMarker name="A" color="#0f0" left={10} variant="cursor" trackDotY={null} />
        );
        const dot = container.querySelector('.rounded-full');
        expect(dot).toBeNull();
    });
});
