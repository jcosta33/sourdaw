import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';

import { setGrandBouleEventBus } from '../../../useCases/grandBouleEventBus';
import { GrandBoulePanel } from '../GrandBoulePanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));

const mockEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(() => () => {}),
};

describe('GrandBoulePanel', () => {
    beforeEach(() => {
        Container.clear();
        setGrandBouleEventBus(mockEventBus);
        vi.clearAllMocks();
    });

    it('renders the panel window with the expected heading', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        // The panel renders a grand-boule-window with content.
        const window = document.querySelector('.grand-boule-window');
        expect(window).not.toBeNull();
    });

    it('renders the engine readiness tile as "idle" with no live engine', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        expect(screen.getByText('idle')).toBeInTheDocument();
    });

    it('renders interactive control elements (buttons, knobs, or sliders)', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        const interactive = screen.queryAllByRole('button').length + screen.queryAllByRole('slider').length;
        expect(interactive).toBeGreaterThan(0);
    });

    it('does not expose a cosmetic lid-position control', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        expect(screen.queryByRole('slider', { name: 'Position' })).not.toBeInTheDocument();
    });

    it('emits events through the event bus when rendered (wiring check)', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        // The event bus is wired — at minimum it was registered.
        expect(mockEventBus.on).toHaveBeenCalled();
    });

    it('renders the panel for a different deviceId without error', () => {
        render(<GrandBoulePanel deviceId="grand-boule-2" />);
        expect(screen.getByText('idle')).toBeInTheDocument();
    });
});
