import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type TrackStoreState } from '#/modules/Arrangement/stores';
import { type GrooveTemplateState } from '#/modules/MIDI/stores';

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
    applyProjection: vi.fn((): Promise<void> => Promise.resolve()),
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
});
