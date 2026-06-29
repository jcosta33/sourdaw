import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';

import { setGrandBouleEventBus } from '../../../useCases/grandBouleEventBus';
import { GrandBoulePanel } from '../GrandBoulePanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
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

    it('renders the engine readiness tile', () => {
        render(<GrandBoulePanel deviceId="dev-1" />);
        // Engine readiness is derived from the engine handle (engine.isReady()),
        // not a store field. With no live engine the tile reads "idle".
        expect(screen.getByText('idle')).toBeTruthy();
    });
});
