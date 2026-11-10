import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SignalFlowSection } from '../Inspector/SignalFlowSection';
import { TrackLevelSection } from '../Inspector/TrackLevelSection';
import { InspectorPanel } from '../InspectorPanel';

import type { Track } from '../../../models/TrackViewTypes';

const mockExecuteAppAction = vi.fn<(action: unknown) => Promise<void>>(() => Promise.resolve());
const mockUseTracks = vi.fn((): { tracks: Track[]; selectedTrackId: string | null } => ({
    tracks: [],
    selectedTrackId: null,
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: () => ({ selectedClipId: null, selectedDeviceId: null }),
}));
vi.mock('../../hooks/useTracks', () => ({ useTracks: () => mockUseTracks() }));
vi.mock('#/modules/Arrangement/stores', () => ({
    clipSelectionStore: {},
    defaultClipSelectionState: { selectedClipId: null, selectedClipIds: [], marqueeSelection: null },
    deviceSelectionStore: {},
    defaultDeviceSelectionState: { selectedDeviceId: null },
    trackStore: { value: null },
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    selectClipWithFocus: vi.fn(),
    clearClipSelection: vi.fn(),
    clearDeviceSelection: vi.fn(),
    selectDevice: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
}));
vi.mock('#/modules/WorkspaceShell/useCases', () => ({ toggleInspector: vi.fn() }));
vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: (action: unknown) => mockExecuteAppAction(action),
}));
vi.mock('#/modules/Automation/useCases', () => ({ releaseTouchAutomation: vi.fn() }));
vi.mock('#/modules/ControlSurface/presentations/views', () => ({ MidiLearnButton: () => null }));
vi.mock('../Inspector/ClipInspector', () => ({ ClipInspector: () => null }));
vi.mock('../Inspector/DeviceInspector', () => ({ DeviceInspector: () => null }));
// The real TrackInspector mounts a dozen store-backed sections; the level
// section carries the in-flight gesture this spec is about.
vi.mock('#/modules/Routing/presentations/views', () => ({ RoutingGraph: () => <div data-testid="routing-graph" /> }));
vi.mock('../Inspector/TrackInspector', () => ({
    TrackInspector: ({
        track,
        signalFlowExpanded,
        onSignalFlowExpandedChange,
    }: {
        track: Track;
        signalFlowExpanded: boolean;
        onSignalFlowExpandedChange: (expanded: boolean) => void;
    }) => (
        <>
            <TrackLevelSection track={track} />
            <SignalFlowSection expanded={signalFlowExpanded} onExpandedChange={onSignalFlowExpandedChange} />
        </>
    ),
}));

const makeTrack = (id: string, name: string, gain: number): Track => ({
    id,
    name,
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain,
    pan: 0,
    color: '#ff0000',
    clips: [],
    devices: [],
    midiFx: [],
    sends: [],
    frozen: false,
    freezeState: { status: 'unfrozen' },
    parentId: null,
    collapsed: false,
    inputMonitoring: 'auto',
    hidden: false,
    disabled: false,
    height: 100,
    outputId: 'master',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'alt-1',
    alternatives: [],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
});

const trackA = makeTrack('track-a', 'Track A', 0.2);
const trackB = makeTrack('track-b', 'Track B', 0.8);
const master: Track = { ...makeTrack('master', 'Master', 1), kind: 'master' };

const selectTrack = (selected: Track): void => {
    mockUseTracks.mockReturnValue({ tracks: [trackA, trackB, master], selectedTrackId: selected.id });
};

const readSliderRoot = (name: string): HTMLElement => {
    const root = screen.getByRole('slider', { name }).closest('[data-slot="slider"]');
    if (!(root instanceof HTMLElement)) {
        throw new TypeError(`Missing Slider root for ${name}`);
    }
    Object.defineProperties(root, {
        setPointerCapture: { configurable: true, value: vi.fn() },
        hasPointerCapture: { configurable: true, value: () => true },
    });
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        bottom: 20,
        left: 0,
        right: 100,
        width: 100,
        height: 20,
        toJSON: () => ({}),
    });
    return root;
};

describe('InspectorPanel track switch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('keeps a half-finished gain drag on its own track when the selection moves', async () => {
        selectTrack(trackA);
        const view = render(<InspectorPanel />);
        const rootA = readSliderRoot('Track A gain');
        fireEvent.pointerDown(rootA, { pointerId: 1, button: 0, clientX: 40, clientY: 10 });
        fireEvent.pointerMove(rootA, { pointerId: 1, clientX: 65, clientY: 10 });
        expect(screen.getByRole('slider', { name: 'Track A gain' })).toHaveAttribute('aria-valuenow', '130');

        selectTrack(trackB);
        view.rerender(<InspectorPanel />);

        expect(screen.getByRole('slider', { name: 'Track B gain' })).toHaveAttribute('aria-valuenow', '80');
        await waitFor(() => {
            expect(mockExecuteAppAction).toHaveBeenCalledTimes(1);
        });
        expect(mockExecuteAppAction).toHaveBeenCalledWith({
            type: 'setTrackGain',
            payload: { trackId: 'track-a', gain: 1.3, expectedGain: 0.2 },
        });

        const rootB = readSliderRoot('Track B gain');
        mockExecuteAppAction.mockClear();
        act(() => {
            fireEvent.pointerUp(rootB, { pointerId: 1 });
            fireEvent.lostPointerCapture(rootB, { pointerId: 1 });
        });
        expect(mockExecuteAppAction).not.toHaveBeenCalled();
        expect(screen.getByRole('slider', { name: 'Track B gain' })).toHaveAttribute('aria-valuenow', '80');
    });

    it('keeps the Signal Flow disclosure open when the selection moves between tracks and to master', () => {
        selectTrack(trackA);
        const view = render(<InspectorPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Signal Flow/ }));
        expect(screen.getByRole('button', { name: /Signal Flow/ })).toHaveAttribute('aria-expanded', 'true');

        selectTrack(trackB);
        view.rerender(<InspectorPanel />);
        expect(screen.getByRole('button', { name: /Signal Flow/ })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('routing-graph')).toBeInTheDocument();

        selectTrack(master);
        view.rerender(<InspectorPanel />);
        expect(screen.getByRole('button', { name: /Signal Flow/ })).toHaveAttribute('aria-expanded', 'true');
    });
});
