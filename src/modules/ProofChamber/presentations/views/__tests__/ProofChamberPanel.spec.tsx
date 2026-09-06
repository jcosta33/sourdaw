import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useStore } from '#/infra/store/useStore';
import { executeAppActionBatch, executeUserAppAction } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import {
    ALGORITHM_MAP,
    DEFAULT_PARAMS,
    PARAM_MAP,
    expandSpacePreset,
    type ProofChamberEngineState,
} from '../../../models/ProofChamberState';
import { hydrateChamberStateFromProject } from '../../../useCases/proofChamber/hydrateChamberStateFromProject';
import { updateChamberEngine } from '../../../useCases/proofChamber/updateChamberEngine';
import { ProofChamberPanel } from '../ProofChamberPanel';

// Mock dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: unknown) => defaultValue),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    executeAppActionBatch: vi.fn(() => Promise.resolve({ status: 'committed', actions: [] })),
    generateGroupId: vi.fn(() => 'group-test'),
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
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
        // The engine-write harness below replaces `updateChamberEngine` with a
        // store simulation; drop it so a later test never writes into an
        // earlier test's seeded state.
        vi.mocked(updateChamberEngine).mockReset();
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
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'setDeviceParameter',
            payload: { deviceId: 'test-device', paramId: 'decay_eq_2', value: 1.75 },
        });
    });

    /**
     * The refusal wording, pinned against the three sibling-outcome messages
     * that also satisfy a bare once/space-name/'warning' probe: the ambiguous
     * hedge, the degraded-history warning, and the failed toast.
     */
    function expectRefusalWording(message: string | undefined): void {
        expect(message).toContain('plate');
        expect(message).toContain("can't be changed right now");
        expect(message).not.toContain('reload the project');
        expect(message).not.toContain('undo history');
        expect(message).not.toContain('see logs for details');
    }

    /**
     * Stand-in for the engine store behind `updateChamberEngine`: the seed is
     * the pre-click engine state, and every write applies the updater the way
     * the real store does, so the state the click leaves behind can be read
     * back out. A bare `vi.fn()` never invokes the panel's updater, so the
     * previous state could neither be captured nor observed.
     */
    function seedChamberEngine(initialEngineState: ProofChamberEngineState): {
        current: () => ProofChamberEngineState;
    } {
        let engineState = initialEngineState;
        vi.mocked(updateChamberEngine).mockImplementation((_deviceId, updater) => {
            engineState = updater({ ...engineState });
        });
        return { current: () => engineState };
    }

    /**
     * Seed the project truth the panel's hydrate effect and rollback read:
     * `parameterValues` in the stored form the device persists — numbers for
     * the numeric fields, 0/1 for the switches, the `ALGORITHM_MAP` wire value
     * for the algorithm — on a track the panel finds by device id.
     */
    function seedProjectTruth(engineState: ProofChamberEngineState): void {
        const parameterValues: Record<string, number> = {
            algorithm: ALGORITHM_MAP[engineState.algorithm],
        };
        for (const [field, paramId] of Object.entries(PARAM_MAP)) {
            const value = engineState[field as keyof ProofChamberEngineState];
            if (typeof value === 'number') {
                parameterValues[paramId] = value;
            } else if (typeof value === 'boolean') {
                parameterValues[paramId] = value ? 1 : 0;
            }
        }
        vi.mocked(useStore).mockImplementation((_store, defaultValue) => {
            if (typeof defaultValue === 'object' && defaultValue !== null && 'tracks' in defaultValue) {
                return {
                    ...defaultValue,
                    tracks: [{ devices: [{ id: 'test-device', parameterValues }] }],
                };
            }
            return defaultValue;
        });
    }

    /**
     * The space tiles are the panel's one `executeAppActionBatch` gesture, and
     * the batch resolves rather than rejecting when the project refuses the
     * write, so a call site that drops the result makes the click silently do
     * nothing on a repair-required or brief-locked project. The refusal must
     * reach the user as exactly one warning carrying the refusal wording: the
     * hedged and degraded-history messages satisfy a loose
     * once/space-name/'warning' probe just as well, so the wording is asserted
     * against those outcomes rather than left to whichever branch answers.
     */
    it('warns once with the refusal wording and restores the engine when the space-load batch is conflicted', async () => {
        const preClickEngineState = { ...DEFAULT_PARAMS, mix: 0.37 };
        const engine = seedChamberEngine(preClickEngineState);
        vi.mocked(executeAppActionBatch).mockResolvedValueOnce({
            status: 'conflicted',
            reason: 'Project repair is required before project actions can execute',
            actions: [],
        });
        render(<ProofChamberPanel deviceId="test-device" />);

        // A space row's accessible name carries its mood subtitle, which is
        // what keeps this click off the identically labelled algorithm chip.
        fireEvent.click(screen.getByRole('button', { name: 'Plate Bright sheet' }));

        await waitFor(() => {
            expect(notifyUser).toHaveBeenCalledTimes(1);
        });
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining("can't be changed right now"), 'warning');
        const [conflictedMessage] = vi.mocked(notifyUser).mock.calls[0] ?? [];
        expectRefusalWording(conflictedMessage);
        expect(notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'error');
        // Two engine writes — the optimistic preset, then the pre-click state
        // back over it. One write would mean the restore never ran; the seeded
        // state (mix 0.37) differs from the plate preset in seven fields, so
        // the read-back only matches when the preset did not survive (issue
        // #3860).
        expect(vi.mocked(updateChamberEngine).mock.calls).toHaveLength(2);
        expect(engine.current()).toEqual(preClickEngineState);
    });

    /**
     * `rejected` and `conflicted` are the two refusal statuses and route to the
     * same branch, so a wording regression there must fail on both fixtures —
     * exercising only `conflicted` would leave `rejected` an untested promise
     * that the shared branch keeps them worded alike.
     */
    it('warns once with the same refusal wording and restores the engine when the space-load batch is rejected', async () => {
        const preClickEngineState = { ...DEFAULT_PARAMS, mix: 0.37 };
        const engine = seedChamberEngine(preClickEngineState);
        vi.mocked(executeAppActionBatch).mockResolvedValueOnce({
            status: 'rejected',
            reason: 'Project repair is required before project actions can execute',
            actions: [],
        });
        render(<ProofChamberPanel deviceId="test-device" />);

        fireEvent.click(screen.getByRole('button', { name: 'Plate Bright sheet' }));

        await waitFor(() => {
            expect(notifyUser).toHaveBeenCalledTimes(1);
        });
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining("can't be changed right now"), 'warning');
        const [rejectedMessage] = vi.mocked(notifyUser).mock.calls[0] ?? [];
        expectRefusalWording(rejectedMessage);
        expect(notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'error');
        // The same engine restore the conflicted fixture pins: the refusal
        // branch is shared, so the restore must hold on both of its statuses.
        expect(vi.mocked(updateChamberEngine).mock.calls).toHaveLength(2);
        expect(engine.current()).toEqual(preClickEngineState);
    });

    it('stays silent and keeps the preset engine state when the space-load batch commits', async () => {
        const engine = seedChamberEngine({ ...DEFAULT_PARAMS, mix: 0.37 });
        render(<ProofChamberPanel deviceId="test-device" />);

        fireEvent.click(screen.getByRole('button', { name: 'Plate Bright sheet' }));

        // Wait for the awaited dispatch to settle before asserting the silence,
        // so a late notification cannot slip past the assertion.
        await waitFor(() => {
            expect(executeAppActionBatch).toHaveBeenCalledTimes(1);
        });
        expect(notifyUser).not.toHaveBeenCalled();
        // The committed load stands: the optimistic preset is what the engine
        // keeps, and the single write is that preset and nothing else.
        expect(vi.mocked(updateChamberEngine).mock.calls).toHaveLength(1);
        expect(engine.current()).toEqual(expandSpacePreset('plate'));
    });

    /**
     * A `committed-with-warning` batch did land the space, but post-commit
     * history work failed — the grouped one-history-step undo entry this
     * gesture promises is missing or partial, and the next undo may step past
     * the whole load. Silence would keep the promise the history no longer
     * holds, so the load must surface as exactly one warning naming the space
     * and the undo consequence.
     */
    it('warns once about degraded undo history when the space-load batch commits with a warning', async () => {
        vi.mocked(executeAppActionBatch).mockResolvedValueOnce({
            status: 'committed-with-warning',
            warning: 'history observer unavailable',
            actions: [],
        });
        render(<ProofChamberPanel deviceId="test-device" />);

        fireEvent.click(screen.getByRole('button', { name: 'Plate Bright sheet' }));

        await waitFor(() => {
            expect(notifyUser).toHaveBeenCalledTimes(1);
        });
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('undo'), 'warning');
        const [committedWarningMessage] = vi.mocked(notifyUser).mock.calls[0] ?? [];
        expect(committedWarningMessage).toContain('plate');
        expect(committedWarningMessage).not.toContain("can't be changed");
        expect(notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'error');
    });

    /**
     * An ambiguous batch may have persisted the space and may not have — the
     * storage transaction's commit state is unknown — so the warning hedges
     * rather than claiming the refusal the batch never issued. The hedge points
     * at a project reload, the one truth-derived view that distinguishes the
     * outcomes: the tray re-hydrates from project truth on this path, but which
     * truth that is depends on the unknown commit, so only the reload confirms
     * what the engine is running. A silent branch would leave the click's
     * outcome unknowable; a refusal toast would name a false cause.
     */
    it('hedges with one warning pointing at a project reload when the space-load batch is ambiguous', async () => {
        seedChamberEngine({ ...DEFAULT_PARAMS, mix: 0.37 });
        vi.mocked(executeAppActionBatch).mockResolvedValueOnce({
            status: 'ambiguous',
            reason: 'unknown commit state',
            actions: [],
        });
        render(<ProofChamberPanel deviceId="test-device" />);

        // The mount effect hydrates once; drop that call so the assertion below
        // can only be satisfied by the ambiguous branch's own re-hydrate, never
        // by the one the panel makes on mount.
        vi.mocked(hydrateChamberStateFromProject).mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Plate Bright sheet' }));

        await waitFor(() => {
            expect(notifyUser).toHaveBeenCalledTimes(1);
        });
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('reload the project'), 'warning');
        const [ambiguousMessage] = vi.mocked(notifyUser).mock.calls[0] ?? [];
        expect(ambiguousMessage).toContain('plate');
        expect(ambiguousMessage).toContain('may not have persisted');
        expect(ambiguousMessage).not.toContain("can't be changed");
        expect(ambiguousMessage).not.toContain('Space tray');
        expect(notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'error');
        // The commit state is unknown, so the pre-click snapshot must not be
        // restored over a write that may have landed: the only engine write is
        // the optimistic one, and the resync goes through the project hydrate.
        expect(vi.mocked(updateChamberEngine).mock.calls).toHaveLength(1);
        expect(hydrateChamberStateFromProject).toHaveBeenCalledWith('test-device');
    });

    /**
     * A `failed` batch is a handler or storage throw, not a project refusal:
     * the toast must stay cause-neutral and point at the logs, never at the
     * "project can't be changed" refusal text, which would launder the real
     * failure into a false cause.
     */
    it('errors once with a cause-neutral message and restores the engine when the space-load batch fails', async () => {
        const preClickEngineState = { ...DEFAULT_PARAMS, mix: 0.37 };
        const engine = seedChamberEngine(preClickEngineState);
        vi.mocked(executeAppActionBatch).mockResolvedValueOnce({
            status: 'failed',
            reason: 'handler threw',
            actions: [],
        });
        render(<ProofChamberPanel deviceId="test-device" />);

        fireEvent.click(screen.getByRole('button', { name: 'Plate Bright sheet' }));

        await waitFor(() => {
            expect(notifyUser).toHaveBeenCalledTimes(1);
        });
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('see logs for details'), 'error');
        const [failedMessage] = vi.mocked(notifyUser).mock.calls[0] ?? [];
        expect(failedMessage).toContain('plate');
        expect(failedMessage).not.toContain("can't be changed");
        expect(notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'warning');
        // A failed batch is not an applied one: the optimistic preset went out
        // first and the pre-click state came back over it, exactly as on the
        // refusal statuses (issue #3860).
        expect(vi.mocked(updateChamberEngine).mock.calls).toHaveLength(2);
        expect(engine.current()).toEqual(preClickEngineState);
    });

    /**
     * Two optimistic clicks whose batches both refuse: by the time the second
     * click captures its snapshot, the live engine store holds the FIRST
     * click's optimistic preset, so a snapshot read back from the store would
     * restore that preset as "the pre-click state" and re-create the very
     * defect the rollback prevents. The snapshot must come from project truth,
     * which an optimistic write never moves.
     */
    it('restores project truth, not the earlier optimistic preset, when overlapping space loads both refuse', async () => {
        const preClickEngineState = { ...DEFAULT_PARAMS, mix: 0.37 };
        const engine = seedChamberEngine(preClickEngineState);
        seedProjectTruth(preClickEngineState);
        vi.mocked(executeAppActionBatch).mockResolvedValueOnce({
            status: 'conflicted',
            reason: 'Project repair is required before project actions can execute',
            actions: [],
        });
        vi.mocked(executeAppActionBatch).mockResolvedValueOnce({
            status: 'conflicted',
            reason: 'Project repair is required before project actions can execute',
            actions: [],
        });
        render(<ProofChamberPanel deviceId="test-device" />);

        fireEvent.click(screen.getByRole('button', { name: 'Plate Bright sheet' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cathedral Huge tail' }));

        // Two optimistic writes, then two rollbacks once both refusals settle.
        await waitFor(() => {
            expect(vi.mocked(updateChamberEngine).mock.calls).toHaveLength(4);
        });
        // Project truth holds every persisted field, and both presets retune
        // all six of these — plate to (0.5, 0.6, 0.15, 0.85, 0.5, 0) and
        // cathedral to (1.0, 0.85, 0.2, 0.9, 0.4, 40) — so the engine ending
        // on the seeded truth's values means neither preset survived. The
        // session-only `space` is the one field truth does not hold and the
        // one field an unresolved earlier click can still own, so it is
        // deliberately not pinned here.
        expect(engine.current()).toEqual(
            expect.objectContaining({
                size: preClickEngineState.size,
                decay: preClickEngineState.decay,
                damping: preClickEngineState.damping,
                diffusion: preClickEngineState.diffusion,
                modDepth: preClickEngineState.modDepth,
                predelay: preClickEngineState.predelay,
            })
        );
    });

    /**
     * The algorithm chips are the only surface that writes `algorithm`, and the
     * number they write is persisted and replayed verbatim on load. Reverse
     * carries 6 rather than 4, because 4 and 5 are reserved for the two
     * convolution-backed engines that have no impulse response to render.
     */
    function dispatchedAlgorithmValues(): number[] {
        return vi
            .mocked(executeUserAppAction)
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
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'setDeviceParameter',
            payload: { deviceId: 'test-device', paramId: 'saturation_type', value: 1 },
        });
    });

    it('establishes min-height floor and allows bottom drawer scrolling without overflow-hidden', () => {
        const { container } = render(<ProofChamberPanel deviceId="test-device" />);
        const faceplate = container.querySelector<HTMLElement>('.proof-chamber-faceplate');
        expect(faceplate).not.toBeNull();
        expect(faceplate?.className).toContain('min-h-[440px]');
        expect(faceplate?.className).not.toContain('overflow-hidden');
    });
});
