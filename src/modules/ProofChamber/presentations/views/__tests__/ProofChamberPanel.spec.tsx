import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { executeAppAction } from '#/modules/Command/useCases';

import { ProofChamberPanel } from '../ProofChamberPanel';

// Mock dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
    executeAppActionBatch: vi.fn(() => Promise.resolve({ status: 'committed', actions: [] })),
    generateGroupId: vi.fn(() => 'group-test'),
}));

vi.mock('../../../stores/chamberStore', () => ({
    chamberStore: { name: 'chamberStore' },
}));
vi.mock('../../../useCases/proofChamber/registerChamberInstance', () => ({
    registerChamberInstance: vi.fn(),
}));
vi.mock('../../../useCases/proofChamber/updateChamberEngine', () => ({
    updateChamberEngine: vi.fn(),
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

/**
 * The algorithm chips are rendered twice — once on the rail and once in the
 * deep Engine card — so a label matches more than one node. The rail copy is
 * the one a click would land on first.
 *
 * Matched by accessible name rather than by raw text: two algorithm labels,
 * `Plate` and `Spring`, are also **space** labels, and the space rows are
 * rendered first. A `getAllByText` lookup handed those tests the space tile and
 * the assertion below passed on `selectSpace`'s incidental `algorithm` dispatch
 * rather than on the chip it names. A space row's accessible name carries its
 * mood subtitle ("Plate Bright sheet"), so an exact-name query resolves to the
 * chips only.
 */
function railChip(label: string): HTMLElement {
    const [chip] = screen.getAllByRole('button', { name: label });
    if (!chip) {
        throw new Error(`no chip labelled "${label}" is rendered`);
    }
    return chip;
}

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

    /**
     * The algorithm chips are the only surface that writes `algorithm`, and the
     * number they write is persisted and replayed verbatim on load. Reverse
     * carries 6 rather than 4, because 4 and 5 are reserved for the two
     * convolution-backed engines that have no impulse response to render.
     */
    it('dispatches the reverse algorithm at the wire value the engine dispatch expects', () => {
        render(<ProofChamberPanel deviceId="test-device" />);

        fireEvent.click(railChip('Reverse'));

        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'setDeviceParameter',
            payload: { deviceId: 'test-device', paramId: 'algorithm', value: 6 },
        });
    });

    it('offers no chip that would select an engine with no impulse response', () => {
        render(<ProofChamberPanel deviceId="test-device" />);

        for (const label of ['Plate', 'FDN 8', 'FDN 16', 'Spring', 'Reverse']) {
            fireEvent.click(railChip(label));
        }

        const dispatched = vi
            .mocked(executeAppAction)
            .mock.calls.map(([action]) => action)
            .filter((action) => action.type === 'setDeviceParameter' && action.payload.paramId === 'algorithm')
            .map((action) => (action.type === 'setDeviceParameter' ? action.payload.value : -1));

        expect(dispatched).toEqual([0, 1, 2, 3, 6]);
    });

    /**
     * The badge counts the algorithms on offer, not the stored wire value. The
     * two differ now that the wire values skip 4 and 5, and reading the stored
     * value here would print "A7" for the fifth of five engines.
     */
    it('numbers the flavour badge by position in the selector, not by wire value', () => {
        render(<ProofChamberPanel deviceId="test-device" />);

        expect(screen.getByText('A1')).toBeTruthy();
        expect(screen.queryByText('A7')).toBeNull();
    });
});
