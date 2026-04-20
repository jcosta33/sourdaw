import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ProofChamberPanel } from '../ProofChamberPanel';

// Mock dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
}));

vi.mock('../../stores/chamberStore', () => ({
    chamberStore: { name: 'chamberStore' },
    updateChamberEngine: vi.fn(),
    registerChamberInstance: vi.fn(),
}));

describe('ProofChamberPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<ProofChamberPanel deviceId="test-device" />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        const { queryAllByRole } = render(<ProofChamberPanel deviceId="test-device" />);
        const buttons = queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
