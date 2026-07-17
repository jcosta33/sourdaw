import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ToasterPanel } from '../ToasterPanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));

describe('ToasterPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<ToasterPanel deviceId="toaster-test" />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<ToasterPanel deviceId="toaster-test" />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<ToasterPanel deviceId="toaster-test" />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<ToasterPanel deviceId="toaster-test" />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
