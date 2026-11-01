import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    clipSelectionStore,
    defaultClipSelectionState,
    defaultDeviceSelectionState,
    deviceSelectionStore,
} from '#/modules/Arrangement/stores';
import { clearClipSelection, selectClipWithFocus, selectDevice } from '#/modules/Arrangement/useCases';

import { InspectorPanel } from '../InspectorPanel';

// The stores and the selection use cases are real: precedence between device
// and clip focus is a property of how they interact, which a mocked store hides.

const mockTrack = {
    id: 'track-1',
    name: 'Test Track',
    kind: 'audio',
    clips: [{ id: 'clip-1', name: 'Test Clip' }],
    devices: [{ id: 'device-1', name: 'Test Device' }],
};

vi.mock('../../hooks/useTracks', () => ({
    useTracks: () => ({ tracks: [mockTrack], selectedTrackId: 'track-1' }),
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    toggleInspector: vi.fn(),
}));

vi.mock('../Inspector/TrackInspector', () => ({
    TrackInspector: () => <div data-testid="track-inspector" />,
}));
vi.mock('../Inspector/ClipInspector', () => ({
    ClipInspector: () => <div data-testid="clip-inspector" />,
}));
vi.mock('../Inspector/DeviceInspector', () => ({
    DeviceInspector: () => <div data-testid="device-inspector" />,
}));

describe('InspectorPanel focus precedence between device and clip', () => {
    beforeEach(() => {
        clipSelectionStore.set(defaultClipSelectionState);
        deviceSelectionStore.set(defaultDeviceSelectionState);
    });

    it('moves from a focused device to a clip selected afterwards', () => {
        render(<InspectorPanel />);
        act(() => selectDevice('device-1'));
        expect(screen.getByTestId('device-inspector')).toBeInTheDocument();

        act(() => selectClipWithFocus('clip-1'));

        expect(screen.getByTestId('clip-inspector')).toBeInTheDocument();
        expect(screen.queryByTestId('device-inspector')).not.toBeInTheDocument();
    });

    it('moves from a selected clip to a device focused afterwards, keeping the clip selected', () => {
        render(<InspectorPanel />);
        act(() => selectClipWithFocus('clip-1'));
        expect(screen.getByTestId('clip-inspector')).toBeInTheDocument();

        act(() => selectDevice('device-1'));

        expect(screen.getByTestId('device-inspector')).toBeInTheDocument();
        expect(clipSelectionStore.value?.selectedClipId).toBe('clip-1');
    });

    it('shows the clip after the inspector was closed with a device focused and a clip was selected meanwhile', () => {
        const first = render(<InspectorPanel />);
        act(() => selectDevice('device-1'));
        expect(screen.getByTestId('device-inspector')).toBeInTheDocument();
        first.unmount();

        act(() => selectClipWithFocus('clip-1'));
        render(<InspectorPanel />);

        expect(screen.getByTestId('clip-inspector')).toBeInTheDocument();
        expect(screen.queryByTestId('device-inspector')).not.toBeInTheDocument();
    });

    it('keeps the focused device when the clip selection is only cleared', () => {
        render(<InspectorPanel />);
        act(() => selectClipWithFocus('clip-1'));
        act(() => selectDevice('device-1'));

        act(() => clearClipSelection());

        expect(screen.getByTestId('device-inspector')).toBeInTheDocument();
    });
});
