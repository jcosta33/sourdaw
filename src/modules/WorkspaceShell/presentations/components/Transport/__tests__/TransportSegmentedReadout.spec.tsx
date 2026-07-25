import { createRef } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { TransportSegmentedReadout } from '../TransportSegmentedReadout';

describe('TransportSegmentedReadout', () => {
    it('invokes onClick when the readout button is clicked', () => {
        const onClick = vi.fn();
        render(
            <TransportSegmentedReadout
                label="Pos"
                segments={['01', '23', '45']}
                separators={['-', ':']}
                onClick={onClick}
                ariaLabel="Playhead position"
            />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Playhead position' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders all three segments and both separators', () => {
        render(
            <TransportSegmentedReadout
                label="Bars"
                segments={[2, 3, '120']}
                separators={['.', '.']}
                onClick={vi.fn()}
                ariaLabel="readout"
            />
        );
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByText('120')).toBeInTheDocument();
        // Two separators, both '.'.
        expect(screen.getAllByText('.')).toHaveLength(2);
    });

    it('renders the eyebrow label', () => {
        render(
            <TransportSegmentedReadout
                label="Time"
                segments={['00', '00', '000']}
                separators={[':', '.']}
                onClick={vi.fn()}
                ariaLabel="readout"
            />
        );
        expect(screen.getByText('Time')).toBeInTheDocument();
    });

    it('applies the inactive (muted) primary tone to segment spans when active is false', () => {
        const { container } = render(
            <TransportSegmentedReadout
                label="Pos"
                segments={['1', '2', '000']}
                separators={['.', '.']}
                active={false}
                onClick={vi.fn()}
                ariaLabel="readout"
            />
        );
        // jsdom converts #b0b0b0 to rgb(176, 176, 176).
        const coloredSpans = container.querySelectorAll<HTMLSpanElement>('span[style*="176, 176, 176"]');
        expect(coloredSpans.length).toBeGreaterThanOrEqual(2);
    });

    it('applies the active (accent) primary tone to segment spans when active is true', () => {
        const { container } = render(
            <TransportSegmentedReadout
                label="Pos"
                segments={['1', '2', '000']}
                separators={['.', '.']}
                active={true}
                onClick={vi.fn()}
                ariaLabel="readout"
            />
        );
        // jsdom converts #7fb8a4 to rgb(127, 184, 164).
        const activePrimary = container.querySelectorAll<HTMLSpanElement>('span[style*="127, 184, 164"]');
        expect(activePrimary.length).toBeGreaterThanOrEqual(2);
    });

    it('applies the active secondary tone to the third segment when active', () => {
        const { container } = render(
            <TransportSegmentedReadout
                label="Pos"
                segments={['1', '2', '240']}
                separators={['.', '.']}
                active={true}
                onClick={vi.fn()}
                ariaLabel="readout"
            />
        );
        // jsdom serializes as rgba(127, 184, 164, 0.5).
        const secondary = container.querySelectorAll<HTMLSpanElement>('span[style*="127, 184, 164, 0.5"]');
        expect(secondary.length).toBeGreaterThanOrEqual(1);
    });

    it('attaches the provided refs to the three segment spans', () => {
        const ref1 = createRef<HTMLSpanElement>();
        const ref2 = createRef<HTMLSpanElement>();
        const ref3 = createRef<HTMLSpanElement>();
        render(
            <TransportSegmentedReadout
                label="Pos"
                segments={['1', '2', '3']}
                separators={['.', '.']}
                segmentRefs={[ref1, ref2, ref3]}
                onClick={vi.fn()}
                ariaLabel="readout"
            />
        );
        expect(ref1.current?.textContent).toBe('1');
        expect(ref2.current?.textContent).toBe('2');
        expect(ref3.current?.textContent).toBe('3');
    });

    it('defaults active to false when not provided', () => {
        const { container } = render(
            <TransportSegmentedReadout
                label="Pos"
                segments={['1', '2', '000']}
                separators={['.', '.']}
                onClick={vi.fn()}
                ariaLabel="readout"
            />
        );
        // Inactive default → primary tone is rgb(176, 176, 176).
        const inactivePrimary = container.querySelectorAll<HTMLSpanElement>('span[style*="176, 176, 176"]');
        expect(inactivePrimary.length).toBeGreaterThanOrEqual(2);
    });
});
