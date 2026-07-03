import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DDSP_INSTRUMENT_CATALOG } from '../../../models/DdspInstrumentCatalog';
import { type ModelRegistryState } from '../../../stores/modelRegistryStore';
import { ModelManagerPanel } from '../ModelManagerPanel';

const mocks = vi.hoisted((): { registryState: ModelRegistryState | undefined } => ({
    registryState: undefined,
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: ModelRegistryState): ModelRegistryState => {
        return mocks.registryState ?? defaultValue;
    }),
}));

function create_registry_with_unavailable_ddsp(): ModelRegistryState {
    return {
        ddspInstruments: DDSP_INSTRUMENT_CATALOG.map((instrument) => ({
            ...instrument,
            status: 'error',
            downloadProgress: 0,
        })),
        kokoroModel: null,
        diffSingerVoicebanks: [],
        vocoder: null,
        storageUsedBytes: 0,
    };
}

describe('ModelManagerPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.registryState = undefined;
    });

    it('should render DDSP instruments as unavailable when the registry marks them unavailable', () => {
        mocks.registryState = create_registry_with_unavailable_ddsp();

        render(<ModelManagerPanel />);

        expect(screen.getByText('DDSP Instruments')).toBeInTheDocument();
        expect(screen.getAllByText('Unavailable')).toHaveLength(DDSP_INSTRUMENT_CATALOG.length);
        expect(
            screen.getByLabelText('Violin unavailable: DDSP browser rendering is not available in this build')
        ).toBeInTheDocument();
        expect(screen.getAllByText('TF.js worker unavailable in this build')).toHaveLength(
            DDSP_INSTRUMENT_CATALOG.length
        );
        expect(screen.queryByText('✓ Cached')).not.toBeInTheDocument();
        expect(screen.queryByText(/available via CDN/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Loaded from CDN/i)).not.toBeInTheDocument();
    });
});
