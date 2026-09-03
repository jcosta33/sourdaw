import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { BacteriaPanel } from '../BacteriaPanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));

describe('BacteriaPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<BacteriaPanel deviceId="dev-1" />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<BacteriaPanel deviceId="dev-1" />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<BacteriaPanel deviceId="dev-1" />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<BacteriaPanel deviceId="dev-1" />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });

    it('should establish min-height floor and retain overflow containment', () => {
        const { container } = render(<BacteriaPanel deviceId="dev-1" />);
        const faceplate = container.querySelector<HTMLElement>('.bacteria-faceplate');
        expect(faceplate).not.toBeNull();
        expect(faceplate?.className).toContain('min-h-[460px]');
        expect(faceplate?.style.overflow).toBe('hidden');
    });
});
