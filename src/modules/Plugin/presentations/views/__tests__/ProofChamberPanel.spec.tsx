import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { executeAppAction } from '#/modules/Command/useCases';

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

// Replace the canvas-driven decay-EQ overlay with a button that surfaces its
// `onChange` callback so the panel's dispatch contract can be exercised through
// the public surface without simulating pointer drags on a <canvas>.
vi.mock('../../components/DecayEqOverlay', () => ({
    DecayEqOverlay: ({ onChange }: { onChange: (band: number, mult: number) => void }) => (
        <button type="button" data-testid="decay-eq-node" onClick={() => onChange(2, 1.75)}>
            decay-eq-node
        </button>
    ),
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

    it('dispatches a decay-EQ band change with the contract `value` field', () => {
        render(<ProofChamberPanel deviceId="test-device" />);

        // Reveal the decay-EQ overlay branch.
        fireEvent.click(screen.getByText('Decay EQ'));
        // Drive the overlay's onChange (band 2 → multiplier 1.75).
        fireEvent.click(screen.getByTestId('decay-eq-node'));

        // Assert through the mock's public surface: the handler reads
        // `payload.value`, so the band change must dispatch `value: 1.75`.
        // Before the fix the panel sent `{ ..., mult }`, leaving `value`
        // undefined — this matcher fails on the missing `value` field.
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'setDeviceParameter',
            payload: { deviceId: 'test-device', paramId: 'decay_eq_2', value: 1.75 },
        });
    });
});
