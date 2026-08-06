import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ControlHeader } from '../ControlHeader';

describe('ControlHeader', () => {
    it('should render label and optional value', () => {
        render(<ControlHeader label="Cutoff" value="440 Hz" />);
        expect(screen.getByText('Cutoff')).toBeTruthy();
        expect(screen.getByText('440 Hz')).toBeTruthy();
    });

    it('renders the label as a label element', () => {
        render(<ControlHeader label="Gain" />);
        expect(screen.getByText('Gain').tagName).toBe('LABEL');
    });

    it('does not render the value element when value is undefined', () => {
        const { container } = render(<ControlHeader label="Resonance" />);
        expect(screen.getByText('Resonance')).toBeTruthy();
        // No value div rendered
        const valueDivs = container.querySelectorAll('.font-mono');
        expect(valueDivs.length).toBe(0);
    });

    it('renders the value element when value is a number zero', () => {
        render(<ControlHeader label="Pan" value={0} />);
        expect(screen.getByText('0')).toBeTruthy();
    });

    it('renders complex label and value content', () => {
        render(
            <ControlHeader
                label={<span data-testid="complex-label">Attack Time</span>}
                value={<span data-testid="complex-value">12.5 ms</span>}
            />
        );
        expect(screen.getByTestId('complex-label')).toBeTruthy();
        expect(screen.getByTestId('complex-value')).toBeTruthy();
    });
});
