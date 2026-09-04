import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MixerStripValue } from '../MixerStripValue';

describe('MixerStripValue', () => {
    it('renders children with default medium size styling', () => {
        render(<MixerStripValue>-12.0 dB</MixerStripValue>);
        const element = screen.getByText('-12.0 dB');
        expect(element).toBeInTheDocument();
        expect(element).toHaveClass('text-[10px]');
    });

    it('supports small size', () => {
        render(
            <MixerStripValue size="sm" data-testid="v">
                0.0
            </MixerStripValue>
        );
        expect(screen.getByTestId('v')).toHaveClass('text-[9px]');
    });

    it('merges custom className with default styling', () => {
        render(
            <MixerStripValue className="custom-class" data-testid="custom">
                +3.5
            </MixerStripValue>
        );
        const element = screen.getByTestId('custom');
        expect(element).toHaveClass('custom-class');
        expect(element).toHaveClass('font-mono');
    });
});
