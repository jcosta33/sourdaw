import { useState } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { InspectorPanel } from '../InspectorPanel';

// Mock external dependencies
const mockUseStore = vi.fn((_store: unknown, _defaultState: unknown): { selectedClipId: string | null } => ({
    selectedClipId: null,
}));
const deviceSelection = vi.hoisted(() => ({
    store: { name: 'deviceSelectionStore' },
    selectedDeviceId: null as string | null,
}));
vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: unknown, defaultState: unknown) => {
        if (store === deviceSelection.store) {
            return { selectedDeviceId: deviceSelection.selectedDeviceId };
        }
        return mockUseStore(store, defaultState);
    },
}));

type TrackFixture = {
    id: string;
    name: string;
    kind: string;
    clips: { id: string; name: string }[];
    devices: { id: string; name: string }[];
};
const mockUseTracks = vi.fn((): { tracks: TrackFixture[]; selectedTrackId: string | null } => ({
    tracks: [],
    selectedTrackId: null,
}));
vi.mock('../../hooks/useTracks', () => ({
    useTracks: () => mockUseTracks(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    clipSelectionStore: {},
    defaultClipSelectionState: { selectedClipId: null, selectedClipIds: [], marqueeSelection: null },
    deviceSelectionStore: deviceSelection.store,
    defaultDeviceSelectionState: { selectedDeviceId: null },
}));

const mockToggleInspector = vi.fn();
const mockClearClipSelection = vi.fn();
const mockSelectClipWithFocus = vi.fn();
const mockClearDeviceSelection = vi.fn();
const mockSelectDevice = vi.fn();

vi.mock('#/modules/Arrangement/useCases', () => ({
    selectClipWithFocus: (id: string) => mockSelectClipWithFocus(id),
    clearClipSelection: () => mockClearClipSelection(),
    clearDeviceSelection: () => mockClearDeviceSelection(),
    selectDevice: (id: string) => mockSelectDevice(id),
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    toggleInspector: () => mockToggleInspector(),
}));

vi.mock('#/components/daw/DawBlockedState', () => ({
    DawBlockedState: ({ title }: { title: string }) => <div data-testid="blocked-state">{title}</div>,
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, actions }: { title?: string; actions?: React.ReactNode }) => (
        <div data-testid="header-band">
            <span>{title}</span>
            {actions ? <div data-testid="header-actions">{actions}</div> : null}
        </div>
    ),
}));

vi.mock('#/components/daw/DawPanelSurface', () => ({
    DawPanelSurface: ({
        children,
        style,
        'aria-label': ariaLabel,
    }: {
        children: React.ReactNode;
        style?: React.CSSProperties;
        'aria-label'?: string;
    }) => (
        <div data-testid="panel-surface" aria-label={ariaLabel} style={style}>
            {children}
        </div>
    ),
}));

vi.mock('#/components/ui/scroll-area', () => ({
    ScrollArea: ({ children }: { children: React.ReactNode }) => <div data-testid="scroll-area">{children}</div>,
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        'aria-label': ariaLabel,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        'aria-label'?: string;
    }) => (
        <button data-testid="button" aria-label={ariaLabel} onClick={onClick}>
            {children}
        </button>
    ),
}));

vi.mock('../Inspector/TrackInspector', () => ({
    TrackInspector: ({ track, onSelectDevice }: { track: { name: string }; onSelectDevice: (id: string) => void }) => (
        <div data-testid="track-inspector">
            Track: {track.name}
            <button type="button" onClick={() => onSelectDevice('device-1')}>
                Pick device
            </button>
        </div>
    ),
}));

vi.mock('../Inspector/ClipInspector', () => ({
    // The initial `useState` value freezes at mount — it only changes if the
    // component actually remounts, which is exactly what distinguishes "keyed
    // by clip id" from "same instance, new props" for the real ClipInspector's
    // rename-draft state (#2039).
    ClipInspector: ({ clip }: { clip: { name: string } }) => {
        const [mountedName] = useState(clip.name);
        return <div data-testid="clip-inspector">Clip: {mountedName}</div>;
    },
}));

vi.mock('../Inspector/DeviceInspector', () => ({
    DeviceInspector: ({ device, onBack }: { device: { name: string }; onBack: () => void }) => (
        <div data-testid="device-inspector">
            Device: {device.name}
            <button type="button" onClick={onBack}>
                Back from device
            </button>
        </div>
    ),
}));

describe('InspectorPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseStore.mockReturnValue({ selectedClipId: null });
        deviceSelection.selectedDeviceId = null;
    });

    it('should render without crashing', () => {
        render(<InspectorPanel />);
        expect(screen.getByText('Inspector')).toBeInTheDocument();
    });

    it('should render panel surface with aria label', () => {
        render(<InspectorPanel />);
        const panelSurface = screen.getByTestId('panel-surface');
        expect(panelSurface).toHaveAttribute('aria-label', 'Inspector panel');
    });

    it('should render close button', () => {
        render(<InspectorPanel />);
        expect(screen.getByLabelText('Close inspector')).toBeInTheDocument();
    });

    it('should call toggleInspector when close button is clicked', () => {
        render(<InspectorPanel />);
        fireEvent.click(screen.getByLabelText('Close inspector'));
        expect(mockToggleInspector).toHaveBeenCalledTimes(1);
    });

    it('should show no track selected state when no tracks exist', () => {
        mockUseTracks.mockReturnValue({ tracks: [], selectedTrackId: null });
        render(<InspectorPanel />);
        expect(screen.getByText(/No track selected/i)).toBeInTheDocument();
    });

    it('honors a squeezed parent slot instead of forcing minWidth 200', () => {
        render(<InspectorPanel style={{ width: 160, minWidth: 160 }} />);
        expect(screen.getByTestId('panel-surface')).toHaveStyle({ width: '160px', minWidth: '160px' });
    });

    it('should render track inspector when track is selected', () => {
        mockUseTracks.mockReturnValue({
            tracks: [{ id: 'track-1', name: 'Test Track', kind: 'audio', clips: [], devices: [] }],
            selectedTrackId: 'track-1',
        });
        render(<InspectorPanel />);
        expect(screen.getByTestId('track-inspector')).toBeInTheDocument();
    });

    it('should render master track inspector when no track selected but master exists', () => {
        mockUseTracks.mockReturnValue({
            tracks: [{ id: 'master', name: 'Master', kind: 'master', clips: [], devices: [] }],
            selectedTrackId: null,
        });
        render(<InspectorPanel />);
        expect(screen.getByTestId('track-inspector')).toBeInTheDocument();
    });

    it('should render clip inspector when clip is selected', () => {
        mockUseStore.mockReturnValue({ selectedClipId: 'clip-1' });
        mockUseTracks.mockReturnValue({
            tracks: [
                {
                    id: 'track-1',
                    name: 'Test Track',
                    kind: 'audio',
                    clips: [{ id: 'clip-1', name: 'Test Clip' }],
                    devices: [],
                },
            ],
            selectedTrackId: 'track-1',
        });
        render(<InspectorPanel />);
        expect(screen.getByTestId('clip-inspector')).toBeInTheDocument();
    });

    it('remounts ClipInspector when the selected clip changes, instead of reusing the instance', () => {
        mockUseStore.mockReturnValue({ selectedClipId: 'clip-1' });
        mockUseTracks.mockReturnValue({
            tracks: [
                {
                    id: 'track-1',
                    name: 'Test Track',
                    kind: 'audio',
                    clips: [
                        { id: 'clip-1', name: 'Clip A' },
                        { id: 'clip-2', name: 'Clip B' },
                    ],
                    devices: [],
                },
            ],
            selectedTrackId: 'track-1',
        });
        const { rerender } = render(<InspectorPanel />);
        expect(screen.getByTestId('clip-inspector')).toHaveTextContent('Clip: Clip A');

        mockUseStore.mockReturnValue({ selectedClipId: 'clip-2' });
        rerender(<InspectorPanel />);

        // Without a `key`, the mounted mock keeps its frozen `mountedName` from
        // clip A — the same leak that let a real rename draft for clip A leak
        // onto clip B.
        expect(screen.getByTestId('clip-inspector')).toHaveTextContent('Clip: Clip B');
    });

    describe('device selection', () => {
        const trackWithDevice = {
            id: 'track-1',
            name: 'Test Track',
            kind: 'audio',
            clips: [],
            devices: [{ id: 'device-1', name: 'Test Device' }],
        };

        it('shows the stored device in the device inspector', () => {
            mockUseTracks.mockReturnValue({ tracks: [trackWithDevice], selectedTrackId: 'track-1' });
            deviceSelection.selectedDeviceId = 'device-1';

            render(<InspectorPanel />);

            expect(screen.getByTestId('device-inspector')).toHaveTextContent('Device: Test Device');
            expect(screen.queryByTestId('track-inspector')).not.toBeInTheDocument();
        });

        it('falls back to the track view when the stored id names no device on the selected track', () => {
            mockUseTracks.mockReturnValue({ tracks: [trackWithDevice], selectedTrackId: 'track-1' });
            deviceSelection.selectedDeviceId = 'device-on-another-track';

            render(<InspectorPanel />);

            expect(screen.getByTestId('track-inspector')).toBeInTheDocument();
            expect(screen.queryByTestId('device-inspector')).not.toBeInTheDocument();
        });

        it('clears the stored selection when the device view goes back', () => {
            mockUseTracks.mockReturnValue({ tracks: [trackWithDevice], selectedTrackId: 'track-1' });
            deviceSelection.selectedDeviceId = 'device-1';
            render(<InspectorPanel />);

            fireEvent.click(screen.getByText('Back from device'));

            expect(mockClearDeviceSelection).toHaveBeenCalledOnce();
        });

        it('stores the device a rack row picks', () => {
            mockUseTracks.mockReturnValue({ tracks: [trackWithDevice], selectedTrackId: 'track-1' });
            render(<InspectorPanel />);

            fireEvent.click(screen.getByText('Pick device'));

            expect(mockSelectDevice).toHaveBeenCalledExactlyOnceWith('device-1');
        });
    });
});
