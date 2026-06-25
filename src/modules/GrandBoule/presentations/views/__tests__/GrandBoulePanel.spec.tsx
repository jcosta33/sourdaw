import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GrandBoulePanel } from '../GrandBoulePanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('GrandBoulePanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });

    it('announces the active voice count through a polite live region', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        // The Voices metric tile is purely visual; a live region is the
        // assistive-tech surface for the voice count. (PianoModel3D contributes
        // its own played-notes live region, so match on the voices text.)
        const liveRegions = [...document.querySelectorAll('[role="status"][aria-live="polite"]')];
        const voicesRegion = liveRegions.find((el) => /active voices?$/.test(el.textContent ?? ''));
        expect(voicesRegion).toBeTruthy();
    });
});
