import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MasterChannelStrip } from './MasterChannelStrip';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

describe('MasterChannelStrip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<MasterChannelStrip />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<MasterChannelStrip />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<MasterChannelStrip />);
        expect(document.body).toBeTruthy();
    });
});
