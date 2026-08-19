import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type TrackStoreState } from '#/modules/Arrangement/stores';
import { type GrooveTemplateState } from '#/modules/MIDI/stores';

import { decodeArpPatternParams, defaultStep, withArpPatternParams } from '../../../models/ArpPattern';
import { type YeastRuntimeStatus } from '../../../models/YeastProcessorProjection';
import { type YeastState } from '../../../stores/yeastStore';
import { YeastPanel } from '../YeastPanel';

const storeMock = vi.hoisted(
    (): {
        yeastState: YeastState | null;
        grooveState: GrooveTemplateState | null;
        setYeastState: ReturnType<typeof vi.fn>;
    } => ({
        yeastState: null,
        grooveState: null,
        setYeastState: vi.fn(),
    })
);
const grooveMocks = vi.hoisted(() => ({
    setYeastGrooveTemplate: vi.fn(),
    proposeYeastGrooveExtraction: vi.fn(),
}));
const runtimeMocks = vi.hoisted(() => ({
    applyProjection: vi.fn((_projection: readonly { id: string; params: Record<string, number> }[]): Promise<void> =>
        Promise.resolve()
    ),
    getStatus: vi.fn((): YeastRuntimeStatus => 'ready'),
    getError: vi.fn((): string | undefined => undefined),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: YeastState | GrooveTemplateState | TrackStoreState) => {
        if ('templates' in defaultValue) {
            return storeMock.grooveState ?? defaultValue;
        }
        if ('tracks' in defaultValue) {
            return defaultValue;
        }
        return storeMock.yeastState ?? defaultValue;
    }),
}));

vi.mock('../../../useCases/getYeastGrooveAssignment', () => ({
    getYeastGrooveAssignment: () => ({ templateId: 'pocket-1', amount: 0.75 }),
    YEAST_GROOVE_OWNER_ID: 'yeast-rack',
}));

vi.mock('../../../useCases/setYeastGrooveTemplate', () => ({
    setYeastGrooveTemplate: grooveMocks.setYeastGrooveTemplate,
}));

vi.mock('../../../useCases/proposeYeastGrooveExtraction', () => ({
    proposeYeastGrooveExtraction: grooveMocks.proposeYeastGrooveExtraction,
}));

vi.mock('../../../stores/yeastStore', () => ({
    yeastStore: {
        get value() {
            return storeMock.yeastState;
        },
        set: storeMock.setYeastState,
    },
}));

vi.mock('../../../engine/yeastRuntime', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../engine/yeastRuntime')>()),
    applyYeastRuntimeProjection: runtimeMocks.applyProjection,
    getYeastRuntimeStatus: runtimeMocks.getStatus,
    getYeastRuntimeError: runtimeMocks.getError,
}));

describe('YeastPanel', () => {
    beforeEach(() => {
        storeMock.yeastState = null;
        storeMock.grooveState = null;
        vi.clearAllMocks();
        storeMock.setYeastState.mockImplementation((state: YeastState | null) => {
            storeMock.yeastState = state;
        });
        runtimeMocks.applyProjection.mockResolvedValue(undefined);
        runtimeMocks.getStatus.mockReturnValue('ready');
        runtimeMocks.getError.mockReturnValue(undefined);
    });

    it('should render the default rack when the store has no value', () => {
        render(<YeastPanel />);

        expect(screen.getByText('Note flow')).toBeInTheDocument();
        expect(screen.getByText('Phrase view')).toBeInTheDocument();
        expect(screen.getByText(/No processors yet/)).toBeInTheDocument();
    });

    it('should expose the default panel controls', () => {
        render(<YeastPanel />);

        expect(screen.getByRole('button', { name: 'Arp Off' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Latch' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '+ Arpeggiator' })).toBeInTheDocument();
        expect(screen.getByText('Mode')).toBeInTheDocument();
        expect(screen.getByText('Rate')).toBeInTheDocument();
    });

    it('binds the Play deck arp controls to the stored processor params', () => {
        storeMock.yeastState = {
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Lead arp lane',
                    bypassed: false,
                    params: { mode: 2, rate_denom: 16, latch: 1 },
                },
            ],
            uiLevel: 1,
        };

        render(<YeastPanel />);

        expect(screen.getByRole('combobox', { name: 'Mode' })).toHaveValue('2');
        expect(screen.getByRole('slider', { name: 'Rate' })).toHaveAttribute('aria-valuenow', '16');
        // The readout follows the stored rate, not a hardcoded 1/8.
        expect(screen.getByText('1/16')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Latch' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('binds the Shape deck knobs to the stored processor params', () => {
        storeMock.yeastState = {
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Lead arp lane',
                    bypassed: false,
                    params: { gate: 1.2, swing: 0.5, octave_range: 3, fixed_velocity: 64 },
                },
            ],
            uiLevel: 2,
        };

        render(<YeastPanel />);

        expect(screen.getByRole('slider', { name: 'Gate' })).toHaveAttribute('aria-valuenow', '1.2');
        expect(screen.getByRole('slider', { name: 'Swing' })).toHaveAttribute('aria-valuenow', '0.5');
        expect(screen.getByRole('slider', { name: 'Octaves' })).toHaveAttribute('aria-valuenow', '3');
        expect(screen.getByRole('slider', { name: 'Velocity' })).toHaveAttribute('aria-valuenow', '64');
    });

    it('renders honest Gate/Swing readouts at mid-range values instead of a collapsed "%"', () => {
        // Pre-fix both readouts used `unit="%"` with the raw fraction: gate 0.8
        // and swing 0.5 both rendered as "1%" (toFixed(0) of the unscaled
        // value), collapsing the entire range to 0/1/2%. Gate is a note-length
        // multiplier (Arpeggiator.ts multiplies step length by it), not a
        // percentage, so it now reads as "×"; swing is a fraction and is
        // scaled to an honest percent.
        storeMock.yeastState = {
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Lead arp lane',
                    bypassed: false,
                    params: { gate: 0.8, swing: 0.5 },
                },
            ],
            uiLevel: 2,
        };

        render(<YeastPanel />);

        expect(screen.getByText('0.8×')).toBeInTheDocument();
        expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('resets a modified Gate knob to its compiled default via alt-click', async () => {
        storeMock.yeastState = {
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Lead arp lane',
                    bypassed: false,
                    params: { gate: 1.2 },
                },
            ],
            uiLevel: 2,
        };

        render(<YeastPanel />);
        const gateSlider = screen.getByRole('slider', { name: 'Gate' });
        expect(gateSlider).toHaveAttribute('aria-valuenow', '1.2');

        // RotaryKnob treats an alt-clicked pointerdown as reset-to-default
        // rather than the start of a drag. Pre-fix, KnobCol passed
        // `defaultValue={value}` (the live value itself), so
        // `Object.is(value, defaultValue)` was always true and this gesture
        // was a permanent no-op.
        fireEvent.pointerDown(gateSlider, { button: 0, pointerId: 1, altKey: true });

        await waitFor(() => {
            expect(storeMock.yeastState?.processors[0]?.params?.gate).toBe(0.8);
        });
    });

    it('commits an integer when dragging the Octaves knob (integer-domain param)', () => {
        // Pre-fix, KnobCol hardcoded step={0.01} for every knob including the
        // integer-domain octave_range (1-4). The worker rounds this param
        // (Arpeggiator.ts setParam), so a fractional commit here would store a
        // value the audio thread silently disagrees with.
        storeMock.yeastState = {
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Lead arp lane',
                    bypassed: false,
                    params: { octave_range: 1 },
                },
            ],
            uiLevel: 2,
        };

        render(<YeastPanel />);
        const octavesSlider = screen.getByRole('slider', { name: 'Octaves' });

        fireEvent.pointerDown(octavesSlider, { button: 0, pointerId: 1, clientY: 100 });
        // deltaY = 55 against a (max-min)/150 = 0.02 sensitivity puts the raw
        // value at 2.1 — step=0.01 would commit 2.1 (fractional); step=1
        // quantizes to the integer 2.
        fireEvent.pointerMove(octavesSlider, { pointerId: 1, clientY: 45 });
        fireEvent.pointerUp(octavesSlider, { pointerId: 1 });

        const committed = storeMock.yeastState?.processors[0]?.params?.octave_range;
        expect(committed).toBe(2);
        expect(Number.isInteger(committed)).toBe(true);
    });

    it('defaults latch to off without a stored param', () => {
        storeMock.yeastState = {
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Lead arp lane',
                    bypassed: false,
                    params: {},
                },
            ],
            uiLevel: 1,
        };

        render(<YeastPanel />);

        expect(screen.getByRole('button', { name: 'Latch' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('slider', { name: 'Rate' })).toHaveAttribute('aria-valuenow', '8');
    });

    it('should render stored processor rack text', () => {
        storeMock.yeastState = {
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Lead arp lane',
                    bypassed: false,
                },
                {
                    id: 'chord-1',
                    type: 'chord',
                    name: 'Harmony latch lane',
                    bypassed: true,
                },
            ],
            uiLevel: 3,
        };

        render(<YeastPanel />);

        expect(screen.getByText('Rack build')).toBeInTheDocument();
        const rack_read = screen.getByText('Rack read').closest('section');
        if (!rack_read) {
            throw new Error('Rack read section not found');
        }

        const rack_read_scope = within(rack_read);
        expect(rack_read_scope.getByText('Lead arp lane')).toBeInTheDocument();
        expect(rack_read_scope.getByText('Harmony latch lane')).toBeInTheDocument();
        expect(rack_read_scope.getByText('arpeggiator')).toBeInTheDocument();
        expect(rack_read_scope.getByText('chord')).toBeInTheDocument();
        expect(rack_read_scope.getByText('Bypass')).toBeInTheDocument();
        expect(rack_read_scope.getByText('Live')).toBeInTheDocument();
    });

    describe('processor rack reorder controls', () => {
        const rackState = (uiLevel: 3 | 4 | 5): YeastState => ({
            processors: [
                { id: 'arp-1', type: 'arpeggiator', name: 'Arpeggiator', bypassed: false, params: {} },
                { id: 'filter-1', type: 'filter', name: 'Note Filter', bypassed: false, params: {} },
                { id: 'transpose-1', type: 'transposer', name: 'Transposer', bypassed: false, params: {} },
            ],
            uiLevel,
        });

        it.each([
            ['Build', 3 as const],
            ['Route', 4 as const],
            ['Lab', 5 as const],
        ])('moves a processor down and commits the new order on the %s deck', (_deck, uiLevel) => {
            storeMock.yeastState = rackState(uiLevel);
            render(<YeastPanel />);

            fireEvent.click(screen.getByRole('button', { name: 'Move Arpeggiator down' }));

            expect(storeMock.yeastState?.processors.map((processor) => processor.id)).toEqual([
                'filter-1',
                'arp-1',
                'transpose-1',
            ]);
        });

        it('moves a processor up and commits the new order', () => {
            storeMock.yeastState = rackState(3);
            render(<YeastPanel />);

            fireEvent.click(screen.getByRole('button', { name: 'Move Note Filter up' }));

            expect(storeMock.yeastState?.processors.map((processor) => processor.id)).toEqual([
                'filter-1',
                'arp-1',
                'transpose-1',
            ]);
        });

        it('disables Up on the first row and Down on the last row', () => {
            storeMock.yeastState = rackState(3);
            render(<YeastPanel />);

            expect(screen.getByRole('button', { name: 'Move Arpeggiator up' })).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Move Transposer down' })).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Move Arpeggiator down' })).toBeEnabled();
            expect(screen.getByRole('button', { name: 'Move Transposer up' })).toBeEnabled();
        });

        it('does not toggle the row expansion when a reorder button is clicked', () => {
            storeMock.yeastState = rackState(3);
            render(<YeastPanel />);

            const downButton = screen.getByRole('button', { name: 'Move Note Filter down' });
            // The reorder button itself also carries a `cursor-pointer` class
            // (its hover affordance), so `.closest()` from the button would
            // match the button before its Row ancestor — start from the
            // parent instead.
            const headerRow = downButton.parentElement?.closest('.cursor-pointer');
            if (!headerRow) {
                throw new Error('processor row header not found');
            }

            fireEvent.click(downButton);

            // Clicking the row header (not a control) is what opens the params
            // panel; the reorder click must not also open it via bubbling — the
            // expand caret in this same row stays "▶", not "▼".
            expect(within(headerRow as HTMLElement).getByText('▶')).toBeInTheDocument();
        });
    });

    it('should bind a groove processor to the MIDI-owned template library', () => {
        storeMock.yeastState = {
            processors: [{ id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false }],
            uiLevel: 3,
        };
        storeMock.grooveState = {
            templates: [
                {
                    id: 'groove-straight',
                    name: 'Straight',
                    schemaVersion: 1,
                    subdivision: '1/16',
                    slots: [],
                    provenance: { type: 'builtin', sourceId: 'straight' },
                },
                {
                    id: 'pocket-1',
                    name: 'Pocket',
                    schemaVersion: 1,
                    subdivision: '1/16',
                    slots: [{ index: 1, timingOffset: 0.2, dynamicsOffset: -0.1 }],
                    provenance: { type: 'user', sourceId: 'test' },
                },
            ],
            // The panel derives the selected template from the subscribed
            // groove state's assignments (not an impure helper read), so the
            // mock state carries the binding directly.
            assignments: [
                {
                    consumerType: 'yeast-processor',
                    consumerId: 'groove-consumer:yeast-rack:groove-1',
                    templateId: 'pocket-1',
                    amount: 0.75,
                },
            ],
        };

        render(<YeastPanel />);
        fireEvent.click(screen.getAllByText('Groove')[0]!);
        const templateSelect = screen.getByRole('combobox', { name: 'Groove template' });
        expect(templateSelect).toHaveValue('pocket-1');

        fireEvent.change(templateSelect, { target: { value: 'groove-straight' } });
        expect(grooveMocks.setYeastGrooveTemplate).toHaveBeenCalledWith('groove-1', 'groove-straight');
    });

    it('passes a supported non-default extraction subdivision to the groove drop target', async () => {
        storeMock.yeastState = {
            processors: [{ id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false }],
            uiLevel: 3,
        };
        grooveMocks.proposeYeastGrooveExtraction.mockReturnValue({
            status: 'extracted',
            clipId: 'clip-source',
            sourceName: 'Source clip',
            subdivision: '1/32',
            sourceRevision: 'source-revision',
            template: {
                id: 'groove-clip-source-v1',
                name: 'Source clip groove',
                schemaVersion: 1,
                subdivision: '1/32',
                slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
                provenance: { type: 'midi-clip', sourceId: 'clip-source', analyzerVersion: 1 },
            },
        });

        render(<YeastPanel />);
        fireEvent.click(screen.getAllByText('Groove')[0]!);
        fireEvent.change(screen.getByRole('combobox', { name: 'Groove extraction subdivision' }), {
            target: { value: '1/32' },
        });
        fireEvent.drop(screen.getByLabelText('Extract groove from MIDI clip'), {
            dataTransfer: {
                getData: (type: string) => (type === 'application/x-sourdaw-midi-clip' ? 'clip-source' : ''),
            },
        });

        expect(grooveMocks.proposeYeastGrooveExtraction).toHaveBeenCalledWith({
            clipId: 'clip-source',
            subdivision: '1/32',
        });
        expect(await screen.findByText('Previewing “Source clip groove”')).toBeInTheDocument();
    });

    it('reports a rejected processor control update through rack feedback immediately', async () => {
        const error = new Error('Projection update failed');
        storeMock.yeastState = {
            processors: [{ id: 'arp-1', type: 'arpeggiator', name: 'Arpeggiator', bypassed: false }],
            uiLevel: 1,
            runtimeStatus: 'ready',
        };
        runtimeMocks.applyProjection.mockRejectedValueOnce(error);
        runtimeMocks.getStatus.mockReturnValue('unavailable');
        runtimeMocks.getError.mockReturnValue(error.message);

        const view = render(<YeastPanel />);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });

        await waitFor(() => {
            expect(storeMock.yeastState).toMatchObject({
                runtimeStatus: 'unavailable',
                runtimeError: error.message,
            });
        });
        view.rerender(<YeastPanel />);

        expect(screen.getByText('Error')).toBeInTheDocument();
        expect(screen.getByText(error.message)).toHaveAttribute('data-reason-code', 'runtime-error');
    });

    it('follows a param change that arrives from another peer', async () => {
        // The controls must track project truth, not latch whatever they first
        // rendered: an inbound CRDT change re-renders the panel with new state.
        storeMock.yeastState = {
            processors: [
                { id: 'arp-1', type: 'arpeggiator', name: 'Arpeggiator', bypassed: false, params: { gate: 1.2 } },
            ],
            uiLevel: 2,
        };
        const view = render(<YeastPanel />);
        expect(screen.getByRole('slider', { name: 'Gate' })).toHaveAttribute('aria-valuenow', '1.2');

        storeMock.yeastState = {
            processors: [
                { id: 'arp-1', type: 'arpeggiator', name: 'Arpeggiator', bypassed: false, params: { gate: 0.3 } },
            ],
            uiLevel: 2,
        };
        view.rerender(<YeastPanel />);

        expect(screen.getByRole('slider', { name: 'Gate' })).toHaveAttribute('aria-valuenow', '0.3');
    });

    describe('arp pattern editor', () => {
        const patternState = (uiLevel: 3 | 5): YeastState => ({
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Arpeggiator',
                    bypassed: false,
                    params: withArpPatternParams({ mode: 7 }, [
                        { ...defaultStep() },
                        { ...defaultStep(), active: false },
                        { ...defaultStep(), velocity: 40, velocityOverride: true },
                    ]),
                },
            ],
            uiLevel,
            runtimeStatus: 'ready',
        });

        it.each([
            ['Build', 3 as const],
            ['Lab', 5 as const],
        ])('renders the stored pattern on the %s deck', (_deck, uiLevel) => {
            storeMock.yeastState = patternState(uiLevel);

            render(<YeastPanel />);

            // Both surfaces read one stored pattern, so both agree on its
            // length and on which steps are switched off.
            expect(screen.getByText('Steps: 3')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Step 1' })).toHaveAttribute('aria-pressed', 'true');
            expect(screen.getByRole('button', { name: 'Step 2' })).toHaveAttribute('aria-pressed', 'false');
        });

        it.each([
            ['Build', 3 as const],
            ['Lab', 5 as const],
        ])('sends a step edit made on the %s deck to the runtime projection', async (_deck, uiLevel) => {
            storeMock.yeastState = patternState(uiLevel);
            render(<YeastPanel />);

            fireEvent.contextMenu(screen.getByRole('button', { name: 'Step 1' }));

            await waitFor(() => {
                expect(runtimeMocks.applyProjection).toHaveBeenCalled();
            });
            const applied = runtimeMocks.applyProjection.mock.calls
                .at(-1)?.[0]
                .find((processor) => processor.id === 'arp-1');
            // The edit is the whole point: step 1 is now inactive in the
            // projection the Worker receives, and step 3's velocity survived.
            expect(decodeArpPatternParams(applied?.params)).toEqual([
                { ...defaultStep(), active: false },
                { ...defaultStep(), active: false },
                { ...defaultStep(), velocity: 40, velocityOverride: true },
            ]);
        });

        it('grows the stored pattern when a length preset is chosen', async () => {
            storeMock.yeastState = patternState(3);
            render(<YeastPanel />);

            fireEvent.click(screen.getByText('8'));

            await waitFor(() => {
                expect(runtimeMocks.applyProjection).toHaveBeenCalled();
            });
            const applied = runtimeMocks.applyProjection.mock.calls
                .at(-1)?.[0]
                .find((processor) => processor.id === 'arp-1');
            expect(decodeArpPatternParams(applied?.params)).toHaveLength(8);
        });

        it('names the arpeggiator the deck is bound to', () => {
            // The deck binds the first arpeggiator; with two in the rack the
            // name is the only way to tell whose persisted pattern is shown.
            storeMock.yeastState = {
                processors: [
                    { id: 'arp-1', type: 'arpeggiator', name: 'Lead arp lane', bypassed: false, params: { mode: 7 } },
                    { id: 'arp-2', type: 'arpeggiator', name: 'Bass arp lane', bypassed: false, params: { mode: 7 } },
                ],
                uiLevel: 3,
            };

            render(<YeastPanel />);

            const patternDeck = screen.getByRole('group', { name: 'Arp pattern — Lead arp lane' });
            expect(within(patternDeck).getByText('Lead arp lane')).toBeInTheDocument();
            expect(screen.queryByRole('group', { name: 'Arp pattern — Bass arp lane' })).not.toBeInTheDocument();
        });

        it('commits a step type edit made from the step badge', async () => {
            storeMock.yeastState = patternState(3);
            render(<YeastPanel />);

            fireEvent.click(screen.getByRole('button', { name: 'Step 1 type' }));

            await waitFor(() => {
                expect(runtimeMocks.applyProjection).toHaveBeenCalled();
            });
            const applied = runtimeMocks.applyProjection.mock.calls
                .at(-1)?.[0]
                .find((processor) => processor.id === 'arp-1');
            expect(decodeArpPatternParams(applied?.params)[0]?.stepType).toBe('rest');
        });

        it('commits a note selector edit made from the step badge', async () => {
            storeMock.yeastState = patternState(3);
            render(<YeastPanel />);

            fireEvent.click(screen.getByRole('button', { name: 'Step 1 note selector' }));

            await waitFor(() => {
                expect(runtimeMocks.applyProjection).toHaveBeenCalled();
            });
            const applied = runtimeMocks.applyProjection.mock.calls
                .at(-1)?.[0]
                .find((processor) => processor.id === 'arp-1');
            expect(decodeArpPatternParams(applied?.params)[0]?.noteSelector).toEqual({ type: 'previous' });
        });

        it('offers no pattern surface on the Lab deck without an arpeggiator', () => {
            storeMock.yeastState = { processors: [], uiLevel: 5 };

            render(<YeastPanel />);

            expect(screen.queryByText(/steps:/i)).not.toBeInTheDocument();
            expect(screen.getByText('Add an Arpeggiator to program a step pattern.')).toBeInTheDocument();
        });
    });
});
