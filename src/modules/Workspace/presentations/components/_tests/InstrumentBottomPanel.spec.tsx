import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InstrumentBottomPanel } from '../InstrumentBottomPanel';

describe('InstrumentBottomPanel', () => {
    it('should render label, close control, and children', () => {
        const onResize = vi.fn();
        const onClose = vi.fn();
        render(
            <InstrumentBottomPanel
                label="Sampler"
                labelColor="text-primary"
                borderColor="border-primary/20"
                height={200}
                onResize={onResize}
                onClose={onClose}
            >
                <div>Panel body</div>
            </InstrumentBottomPanel>
        );
        expect(screen.getByText('Sampler')).toBeInTheDocument();
        expect(screen.getByText('Panel body')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close Sampler' })).toBeInTheDocument();
    });
});
