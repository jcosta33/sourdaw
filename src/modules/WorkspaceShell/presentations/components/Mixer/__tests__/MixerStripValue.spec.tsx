import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { MixerStripValue } from '../MixerStripValue';

describe('MixerStripValue', () => {
    it('renders its children content', () => {
        render(<MixerStripValue>-6.0 dB</MixerStripValue>);

        expect(screen.getByText('-6.0 dB')).toBeInTheDocument();
    });

    it('defaults to the medium size text class', () => {
        render(<MixerStripValue>0.0</MixerStripValue>);

        expect(screen.getByText('0.0')).toHaveClass('text-[10px]');
    });

    it('applies the small size text class when size is sm', () => {
        render(<MixerStripValue size="sm">Pan</MixerStripValue>);

        expect(screen.getByText('Pan')).toHaveClass('text-[9px]');
        expect(screen.getByText('Pan')).not.toHaveClass('text-[10px]');
    });

    it('merges a caller-supplied className alongside the base classes', () => {
        render(<MixerStripValue className="custom-strip-value">Gain</MixerStripValue>);

        const element = screen.getByText('Gain');
        expect(element).toHaveClass('custom-strip-value');
        expect(element).toHaveClass('font-mono');
    });

    it('forwards remaining span attributes', () => {
        render(<MixerStripValue data-testid="strip-value">1.5</MixerStripValue>);

        expect(screen.getByTestId('strip-value')).toHaveTextContent('1.5');
    });
});
