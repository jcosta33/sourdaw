import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ModulationMatrix } from '../ModulationMatrix';

type StoreValue = {
    modulators: Array<{
        id: string;
        name: string;
        kind: 'lfo' | 'envelope' | 'step';
        trackId: string;
        enabled: boolean;
        mappings: Array<{
            targetTrackId: string;
            targetDeviceId: string;
            targetParamId: string;
            amount: number;
        }>;
    }>;
};

type TrackStoreValue = {
    tracks: Array<{
        id: string;
        name: string;
        devices: Array<{ id: string; name: string; type: string }>;
    }>;
};

const mocks = vi.hoisted(() => ({
    modState: { modulators: [] } as StoreValue,
    trackState: { tracks: [] } as TrackStoreValue,
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: { __id?: string }, defaultValue: unknown) => {
        if (store.__id === 'modulation') {
            return mocks.modState;
        }
        if (store.__id === 'track') {
            return mocks.trackState;
        }
        return defaultValue;
    },
}));

vi.mock('../../../stores/modulationStore', () => ({
    modulationStore: { __id: 'modulation' },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { __id: 'track' },
    defaultTrackState: { tracks: [], selectedTrackId: null },
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getPluginById: () => ({
        parameters: [{ id: 'cutoff', name: 'Cutoff', automatable: true, minValue: 0, maxValue: 1 }],
    }),
}));

vi.mock('../../../useCases/modulation/addMapping', () => ({ addMapping: vi.fn() }));
vi.mock('../../../useCases/modulation/addModulator', () => ({ addModulator: vi.fn() }));
vi.mock('../../../useCases/modulation/removeMapping', () => ({ removeMapping: vi.fn() }));
vi.mock('../../../useCases/modulation/removeModulator', () => ({ removeModulator: vi.fn() }));
vi.mock('../../../useCases/modulation/updateMapping', () => ({ updateMapping: vi.fn() }));
vi.mock('../../../useCases/modulation/updateModulator', () => ({ updateModulator: vi.fn() }));

describe('ModulationMatrix', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.modState.modulators = [];
        mocks.trackState.tracks = [];
    });

    it('should render without crashing', () => {
        const { container } = render(<ModulationMatrix />);
        expect(container.firstChild).not.toBeNull();
    });

    it('should render empty state when there are no modulators', () => {
        render(<ModulationMatrix />);
        expect(screen.getByText('No modulators')).toBeInTheDocument();
    });

    it('should render a card per modulator when present', () => {
        mocks.modState.modulators = [
            {
                id: 'mod-1',
                name: 'LFO 1',
                kind: 'lfo',
                trackId: 'track-1',
                enabled: true,
                mappings: [],
            },
            {
                id: 'mod-2',
                name: 'Env 1',
                kind: 'envelope',
                trackId: 'track-1',
                enabled: true,
                mappings: [],
            },
        ];
        render(<ModulationMatrix />);
        expect(screen.getByLabelText('Rename modulator mod-1')).toBeInTheDocument();
        expect(screen.getByLabelText('Rename modulator mod-2')).toBeInTheDocument();
    });

    it('should open the new modulator form on clicking New Modulator', () => {
        render(<ModulationMatrix />);
        const newButton = screen.getByRole('button', { name: /new modulator/i });
        expect(newButton).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(newButton);
        expect(newButton).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByLabelText('Modulator name')).toBeInTheDocument();
        expect(screen.getByLabelText('Modulator kind')).toBeInTheDocument();
    });

    it('should expose a region role with an accessible name', () => {
        render(<ModulationMatrix />);
        const region = screen.getByRole('region', { name: /modulation matrix/i });
        expect(region).toBeInTheDocument();
    });
});
