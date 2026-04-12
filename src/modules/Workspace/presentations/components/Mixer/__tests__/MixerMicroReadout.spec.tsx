import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MixerMicroReadout } from '../MixerMicroReadout';

describe('MixerMicroReadout', () => {
    it('should render label and value', () => {
        render(<MixerMicroReadout label="Pan" value="C" />);
        expect(screen.getByText('Pan')).toBeInTheDocument();
        expect(screen.getByText('C')).toBeInTheDocument();
    });

    it('should render endSlot instead of value when provided', () => {
        render(<MixerMicroReadout label="X" endSlot={<span data-testid="end">slot</span>} />);
        expect(screen.getByTestId('end')).toHaveTextContent('slot');
    });
});
