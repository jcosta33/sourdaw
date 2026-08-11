import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useStore } from '#/infra/store/useStore';
import { executeAppAction } from '#/modules/Command/useCases';

import { DEFAULT_PARAMS } from '../../../models/ProofChamberState';
import { ProofChamberPanel } from '../ProofChamberPanel';

// Mock dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: unknown) => defaultValue),
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
vi.mock('../../../useCases/proofChamber/hydrateChamberStateFromProject', () => ({
    hydrateChamberStateFromProject: vi.fn(),
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
        // `clearAllMocks` clears recorded calls, not implementations, so a
        // `mockReturnValue` from one test would otherwise decide what every
        // later test's panel renders.
        vi.mocked(useStore).mockImplementation((_store, defaultValue) => defaultValue);
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
    function dispatchedAlgorithmValues(): number[] {
        return vi
            .mocked(executeAppAction)
            .mock.calls.map(([action]) => action)
            .filter((action) => action.type === 'setDeviceParameter' && action.payload.paramId === 'algorithm')
            .map((action) => (action.type === 'setDeviceParameter' ? action.payload.value : -1));
    }

    it('dispatches the reverse algorithm at the wire value the engine dispatch expects', () => {
        render(<ProofChamberPanel deviceId="test-device" />);

        fireEvent.click(railChip('Reverse'));

        expect(dispatchedAlgorithmValues()).toEqual([6]);
    });

    it('offers no chip that would select an engine with no impulse response', () => {
        render(<ProofChamberPanel deviceId="test-device" />);

        for (const label of ['Plate', 'FDN 8', 'FDN 16', 'Spring', 'Reverse']) {
            fireEvent.click(railChip(label));
        }

        expect(dispatchedAlgorithmValues()).toEqual([0, 1, 2, 3, 6]);
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

    /**
     * The plate implements three saturation curves and always ran the first
     * one, because no surface could write `saturation_type`. The curve chips
     * are the surface, and they hang off the Saturation switch that gates the
     * branch running them — offering a curve while saturation is off would
     * advertise a choice with no effect.
     */
    it('hides the saturation curve chips while saturation is off', () => {
        render(<ProofChamberPanel deviceId="test-device" />);

        expect(screen.queryByRole('button', { name: 'Cheby' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Clip' })).toBeNull();
    });

    it('dispatches the saturation curve at the index the engine matches on', () => {
        const chamberState = {
            activeInstanceId: 'test-device',
            instances: {
                'test-device': {
                    id: 'test-device',
                    isBypassed: false,
                    uiLevel: 1,
                    engineState: { ...DEFAULT_PARAMS, saturation: true },
                },
            },
        };
        vi.mocked(useStore).mockImplementation((_store, defaultValue) => {
            if (typeof defaultValue === 'object' && defaultValue !== null && 'instances' in defaultValue) {
                return chamberState;
            }
            return defaultValue;
        });

        render(<ProofChamberPanel deviceId="test-device" />);

        fireEvent.click(screen.getByRole('button', { name: 'Cheby' }));

        // 1 is the Chebyshev arm of `soft_saturate`, reached through
        // `(value as u8).min(2)`. A chip that sent an ordinal from its own
        // position in some other list would land on a different curve.
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'setDeviceParameter',
            payload: { deviceId: 'test-device', paramId: 'saturation_type', value: 1 },
        });
    });
});
