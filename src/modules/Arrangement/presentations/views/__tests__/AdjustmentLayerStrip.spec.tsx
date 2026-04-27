import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AdjustmentLayerStrip } from '../AdjustmentLayerStrip';

type MockLayer = {
    id: string;
    name: string;
    effectType: 'eq' | 'volume' | 'pan';
    parameters: Array<{ name: string; value: number; min: number; max: number; unit: string }>;
    affectedTrackIds: string[];
    insertionIndex: number;
    regions: Array<{
        id: string;
        startBeat: number;
        endBeat: number;
        blend: number;
        fadeInBeats: number;
        fadeOutBeats: number;
    }>;
    enabled: boolean;
    mix: number;
    color: string;
};

const mocks = vi.hoisted(() => ({
    layers: [] as MockLayer[],
    executeAppAction: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: () => ({ layers: mocks.layers }),
}));

vi.mock('../../../stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {},
    EFFECT_PRESETS: {
        eq: [{ name: 'Gain', value: 0, min: -12, max: 12, unit: 'dB' }],
        volume: [],
        pan: [],
    },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('../TimelineChromeSurface', () => ({
    TimelineChromeSurface: ({
        children,
        role,
        'aria-label': ariaLabel,
        style,
    }: {
        children: React.ReactNode;
        role?: string;
        'aria-label'?: string;
        style?: React.CSSProperties;
    }) => (
        <div role={role} aria-label={ariaLabel} style={style} data-testid="timeline-chrome">
            {children}
        </div>
    ),
}));

describe('AdjustmentLayerStrip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.layers = [];
    });

    const renderStrip = () => render(<AdjustmentLayerStrip pixelsPerBeat={20} scrollX={0} />);

    it('should render without crashing', () => {
        const { container } = renderStrip();
        expect(container.firstChild).not.toBeNull();
    });

    it('should expose a region role with an accessible name', () => {
        renderStrip();
        const region = screen.getByRole('region', { name: /adjustment layers/i });
        expect(region).toBeInTheDocument();
    });

    it('should render a bar per layer', () => {
        mocks.layers = [
            {
                id: 'L1',
                name: 'EQ Layer',
                effectType: 'eq',
                parameters: [],
                affectedTrackIds: [],
                insertionIndex: 0,
                regions: [{ id: 'r1', startBeat: 0, endBeat: 4, blend: 1, fadeInBeats: 0, fadeOutBeats: 0 }],
                enabled: true,
                mix: 1,
                color: '#ff0000',
            },
            {
                id: 'L2',
                name: 'Compressor',
                effectType: 'volume',
                parameters: [],
                affectedTrackIds: [],
                insertionIndex: 1,
                regions: [{ id: 'r2', startBeat: 2, endBeat: 8, blend: 1, fadeInBeats: 0, fadeOutBeats: 0 }],
                enabled: true,
                mix: 1,
                color: '#00ff00',
            },
        ];
        renderStrip();
        expect(screen.getByText('EQ Layer')).toBeInTheDocument();
        expect(screen.getByText('Compressor')).toBeInTheDocument();
    });

    it('should dispatch addAdjustmentRegion on Alt+click of a lane', () => {
        mocks.layers = [
            {
                id: 'L1',
                name: 'EQ Layer',
                effectType: 'eq',
                parameters: [],
                affectedTrackIds: [],
                insertionIndex: 0,
                regions: [],
                enabled: true,
                mix: 1,
                color: '#ff0000',
            },
        ];
        renderStrip();
        const layerRow = screen.getByText('EQ Layer').closest('div[class*="absolute"]')!.parentElement!;
        fireEvent.click(layerRow, { altKey: true, button: 0, clientX: 200 });
        const calls = mocks.executeAppAction.mock.calls;
        const addRegionCall = calls.find((call) => {
            const action = call[0] as { type: string };
            return action.type === 'addAdjustmentRegion';
        });
        expect(addRegionCall).toBeDefined();
    });

    it('should open a context menu on right-click of a region', () => {
        mocks.layers = [
            {
                id: 'L1',
                name: 'EQ Layer',
                effectType: 'eq',
                parameters: [],
                affectedTrackIds: [],
                insertionIndex: 0,
                regions: [{ id: 'r1', startBeat: 2, endBeat: 8, blend: 1, fadeInBeats: 0, fadeOutBeats: 0 }],
                enabled: true,
                mix: 1,
                color: '#ff0000',
            },
        ];
        renderStrip();
        const layerRow = screen.getByText('EQ Layer').closest('div[class*="absolute"]')!.parentElement!;
        fireEvent.contextMenu(layerRow, { clientX: 100, clientY: 100 });
        expect(screen.getByText(/disable layer|enable layer/i)).toBeInTheDocument();
    });

    it('should open the Add menu when the add button is clicked', () => {
        renderStrip();
        const addButton = screen.getByRole('button', { name: /add adjustment layer/i });
        fireEvent.click(addButton);
        expect(screen.getByText('New Adjustment Layer')).toBeInTheDocument();
    });
});
