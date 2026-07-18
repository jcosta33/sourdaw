import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { MixerStripValue } from '../MixerStripValue';

describe('MixerStripValue', () => {
    it('should render children', () => {
        render(<MixerStripValue>-12.0 dB</MixerStripValue>);
        expect(screen.getByText('-12.0 dB')).toBeInTheDocument();
    });

    it('should support small size', () => {
        render(
            <MixerStripValue size="sm" data-testid="v">
                0.0
            </MixerStripValue>
        );
        expect(screen.getByTestId('v')).toHaveClass('text-[9px]');
    });
});
