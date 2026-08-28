import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { BacteriaPanel } from '#/modules/Bacteria/presentations/views';

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

/**
 * Regression guard for #2311: the Bacteria faceplate spilled past its own box
 * and, painting as the later sibling of the panel column, covered the chrome's
 * Close Bacteria button — pointer clicks hit the faceplate subtree and did
 * nothing, while keyboard activation kept working.
 */
describe('InstrumentBottomPanel — Bacteria faceplate containment (#2311)', () => {
    const getFaceplate = (): HTMLElement | null => document.querySelector<HTMLElement>('.bacteria-faceplate');

    const renderBacteriaPanel = (deviceId: string, onClose: () => void): void => {
        render(
            <InstrumentBottomPanel
                label="Bacteria"
                labelColor="text-rose-400"
                borderColor="border-rose-500/20"
                height={420}
                onResize={vi.fn()}
                onClose={onClose}
            >
                <BacteriaPanel deviceId={deviceId} />
            </InstrumentBottomPanel>
        );
    };

    it('clicking Close Bacteria fires the close path with the faceplate clipped off the chrome', () => {
        const onClose = vi.fn();
        renderBacteriaPanel('dev-2311-click', onClose);

        fireEvent.click(screen.getByRole('button', { name: 'Close Bacteria' }));
        expect(onClose).toHaveBeenCalledTimes(1);

        // jsdom lays nothing out, so the overlap itself cannot render here and
        // the click above exercises only the handler wiring. This asserts the
        // fix's mechanism instead: the faceplate root clips its subtree. In a
        // real browser an `overflow: hidden` faceplate can neither paint nor
        // hit-test above its own box, so the Close button — an earlier sibling
        // in the panel column — stays the top hit target for pointer clicks.
        const faceplate = getFaceplate();
        expect(faceplate).not.toBeNull();
        expect(getComputedStyle(faceplate as HTMLElement).overflow).toBe('hidden');
    });

    it('Close Bacteria stays keyboard-operable', () => {
        const onClose = vi.fn();
        renderBacteriaPanel('dev-2311-keyboard', onClose);

        const closeBtn = screen.getByRole('button', { name: 'Close Bacteria' });
        closeBtn.focus();
        // The containment clips painting only; the control must remain
        // focusable for Enter activation, which the browser synthesizes into
        // the same click jsdom cannot synthesize here.
        expect(closeBtn).toBe(document.activeElement);
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('faceplate controls keep receiving their own interactions', async () => {
        const onClose = vi.fn();
        renderBacteriaPanel('dev-2311-faceplate', onClose);

        // The fix clips overflow; it must not blanket-disable pointer events on
        // the faceplate, or every control inside it would die with the fix.
        const faceplate = getFaceplate() as HTMLElement;
        expect(getComputedStyle(faceplate).pointerEvents).not.toBe('none');

        // A faceplate interaction still routes end to end: clicking the Shape
        // level chip writes the bacteria store and re-renders the level-2 hero
        // ('Zoomed strips' exists only in that hero).
        fireEvent.click(screen.getByRole('button', { name: 'Shape' }));
        expect(await screen.findByText('Zoomed strips')).toBeTruthy();
        expect(onClose).not.toHaveBeenCalled();
    });
});
