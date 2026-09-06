import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GlutenPanel } from '../GlutenPanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));

// deviceId is a required prop on GlutenPanel — render with a real one.
const DEVICE_ID = 'gluten-test-device';

describe('GlutenPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<GlutenPanel deviceId={DEVICE_ID} />);
        expect(document.body).toBeTruthy();
    });

    it('should render interactive elements', () => {
        // Fix 5 — the old assertion (>= 0) was vacuous; the panel is dense with
        // controls, so it must render at least one button.
        render(<GlutenPanel deviceId={DEVICE_ID} />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(1);
    });

    it('should expose the supported oversampling factors and not the invalid factor 3', () => {
        // Fix 3 — the OS control is now a discrete toggle over {1×, 2×, 4×}; the
        // step-1 knob that could select 3 is gone.
        render(<GlutenPanel deviceId={DEVICE_ID} />);
        expect(screen.getByText('1×')).toBeTruthy();
        expect(screen.getByText('2×')).toBeTruthy();
        expect(screen.getByText('4×')).toBeTruthy();
        expect(screen.queryByText('3×')).toBeNull();
    });

    it('should give the GR meter a per-instance accessible label derived from the patch name', () => {
        // The panel must pass a `label` to GrMeter so every open Gluten panel's
        // meter is distinguishable, rather than all sharing the default
        // 'Gain reduction meter'. The default patch is named 'Init'.
        render(<GlutenPanel deviceId={DEVICE_ID} />);
        const meter = screen.getByLabelText('Init gain reduction meter');
        expect(meter.getAttribute('role')).toBe('meter');
    });

    it('applies minimum height floor and does not clip overflow at root', () => {
        const { container } = render(<GlutenPanel deviceId={DEVICE_ID} />);
        const faceplate = container.querySelector('.gluten-faceplate');
        expect(faceplate).toHaveClass('min-h-[440px]');
        expect(faceplate).not.toHaveClass('overflow-hidden');
    });

    it('prevents control cards from collapsing when faceplate is compressed', () => {
        const { container } = render(<GlutenPanel deviceId={DEVICE_ID} />);
        const cards = container.querySelectorAll('.gluten-window.shrink-0');
        expect(cards).toHaveLength(6);
        for (const title of ['Clamp', 'Finish', 'Detector', 'Character', 'Stage two']) {
            const heading = screen.getByText(title);
            const section = heading.closest('section');
            expect(section).not.toBeNull();
            expect(section?.className).toContain('shrink-0');
        }
    });

    it('renders topology buttons with stacked icon-led header and labels to prevent horizontal squashing', () => {
        render(<GlutenPanel deviceId={DEVICE_ID} />);
        const topologyLabels = ['VCA', 'FET', 'Opto', 'Diode'];
        const topologyButtons = screen
            .getAllByRole('button')
            .filter(
                (b) =>
                    topologyLabels.some((t) => b.textContent?.includes(t)) &&
                    ['Bus duty', 'Settle', 'Snap', 'Weight'].some((t) => b.textContent?.includes(t))
            );
        expect(topologyButtons).toHaveLength(4);
        for (const label of topologyLabels) {
            const button = topologyButtons.find((b) => b.textContent?.includes(label));
            expect(button).toBeDefined();
            expect(button?.children).toHaveLength(2);
            const headerRow = button?.firstElementChild;
            expect(headerRow?.querySelector('svg')).not.toBeNull();
            expect(headerRow?.textContent).not.toContain(label);
            expect(button?.children[1]?.textContent).toContain(label);
        }
    });
});
