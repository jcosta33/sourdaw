import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GlutenPanel } from '../GlutenPanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
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
});
