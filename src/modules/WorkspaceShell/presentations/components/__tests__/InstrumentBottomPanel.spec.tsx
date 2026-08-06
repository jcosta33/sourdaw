import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { InstrumentBottomPanel } from '../InstrumentBottomPanel';

describe('InstrumentBottomPanel', () => {
    it('should render label, close control, and children', () => {
        render(
            <InstrumentBottomPanel
                label="Sampler"
                labelColor="text-primary"
                borderColor="border-primary/20"
                height={200}
                onResize={vi.fn()}
                onClose={vi.fn()}
            >
                <div>Panel body</div>
            </InstrumentBottomPanel>
        );
        expect(screen.getByText('Sampler')).toBeTruthy();
        expect(screen.getByText('Panel body')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Close Sampler' })).toBeTruthy();
    });
});

describe('InstrumentBottomPanel — aria-label and callbacks', () => {
    it('uses the label in the close button aria-label', () => {
        render(
            <InstrumentBottomPanel
                label="Fermenter"
                labelColor="text-mint"
                borderColor="border-mint/20"
                height={300}
                onResize={vi.fn()}
                onClose={vi.fn()}
            >
                <span />
            </InstrumentBottomPanel>
        );
        expect(screen.getByRole('button', { name: 'Close Fermenter' })).toBeTruthy();
    });

    it('fires onClose when the close button is clicked', () => {
        const onClose = vi.fn();
        render(
            <InstrumentBottomPanel
                label="Toaster"
                labelColor="text-peach"
                borderColor="border-peach/20"
                height={200}
                onResize={vi.fn()}
                onClose={onClose}
            >
                <span />
            </InstrumentBottomPanel>
        );
        fireEvent.click(screen.getByRole('button', { name: 'Close Toaster' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('applies the height prop to the panel container style', () => {
        render(
            <InstrumentBottomPanel
                label="X"
                labelColor="text-white"
                borderColor="border-white/20"
                height={250}
                onResize={vi.fn()}
                onClose={vi.fn()}
            >
                <span />
            </InstrumentBottomPanel>
        );
        const container = screen.getByText('X').closest('div[class*="flex flex-col"]')!;
        expect(container.getAttribute('style')).toContain('height: 250px');
    });

    it('renders children content inside the panel body', () => {
        render(
            <InstrumentBottomPanel
                label="X"
                labelColor="text-white"
                borderColor="border-white/20"
                height={200}
                onResize={vi.fn()}
                onClose={vi.fn()}
            >
                <div data-testid="child-content">Child element</div>
            </InstrumentBottomPanel>
        );
        expect(screen.getByTestId('child-content')).toBeTruthy();
    });
});
