import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DeviceChainSection } from '../DeviceChainSection';

import type { Device, Track } from '../../../../models/TrackViewTypes';

// Minimal local stand-in for Arrangement's PluginDescriptor — this module must not deep-import
// another module's models (AGENTS.md layer boundaries); only the fields the component reads.
type PluginStub = { id: string; name: string };

const mocks = vi.hoisted(() => ({
    selectTrack: vi.fn(),
    bypassDevice: vi.fn(),
    addDevice: vi.fn(),
    removeDevice: vi.fn(),
    reorderDevices: vi.fn(),
    getPlatformPlugins: vi.fn<() => PluginStub[]>(() => []),
    openInspector: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    selectTrack: mocks.selectTrack,
    bypassDevice: mocks.bypassDevice,
    addDevice: mocks.addDevice,
    removeDevice: mocks.removeDevice,
    reorderDevices: mocks.reorderDevices,
    getPlatformPlugins: mocks.getPlatformPlugins,
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    openInspector: mocks.openInspector,
}));

const baseTrack: Track = {
    id: 'track-1',
    name: 'Track 1',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    color: '#ff0000',
    clips: [],
    devices: [],
    sends: [],
    frozen: false,
    freezeState: { status: 'unfrozen' },
    parentId: null,
    collapsed: false,
    inputMonitoring: 'auto',
    hidden: false,
    disabled: false,
    height: 80,
    outputId: 'master',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'alt-1',
    alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
    midiFx: [],
};

const makeDevice = (overrides: Partial<Device> = {}): Device => ({
    id: 'dev-1',
    name: 'Delay',
    type: 'delay',
    bypassed: false,
    parameterValues: {},
    ...overrides,
});

describe('DeviceChainSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getPlatformPlugins.mockReturnValue([]);
    });

    it('selects the track and opens the inspector when a device is clicked', () => {
        const track: Track = { ...baseTrack, id: 'track-5', devices: [makeDevice()] };
        render(<DeviceChainSection track={track} />);

        fireEvent.click(screen.getByText('Delay').closest('button')!);

        expect(mocks.selectTrack).toHaveBeenCalledWith('track-5');
        expect(mocks.openInspector).toHaveBeenCalledTimes(1);
    });

    it('toggles bypass on double-click', () => {
        const track: Track = { ...baseTrack, devices: [makeDevice({ id: 'dev-9', bypassed: false })] };
        render(<DeviceChainSection track={track} />);

        fireEvent.doubleClick(screen.getByText('Delay').closest('button')!);

        expect(mocks.bypassDevice).toHaveBeenCalledWith('dev-9', true);
    });

    it('removes a device via its remove button', () => {
        const track: Track = { ...baseTrack, devices: [makeDevice({ id: 'dev-9', name: 'Chorus' })] };
        render(<DeviceChainSection track={track} />);

        fireEvent.click(screen.getByLabelText('Remove Chorus'));

        expect(mocks.removeDevice).toHaveBeenCalledWith('dev-9');
    });

    it('lists built-in plugins and MIDI FX after "+ add", dispatches addDevice on choice, and closes on cancel without dispatching', () => {
        mocks.getPlatformPlugins.mockReturnValue([{ id: 'plug-1', name: 'Delay Line' }]);
        const track: Track = { ...baseTrack, id: 'track-7' };
        render(<DeviceChainSection track={track} />);

        expect(screen.queryByText('+ Delay Line')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('+ add'));

        expect(screen.getByText('+ Delay Line')).toBeInTheDocument();
        expect(screen.getByText('♪ Chord Generator')).toBeInTheDocument();

        fireEvent.click(screen.getByText('cancel'));
        expect(screen.queryByText('+ Delay Line')).not.toBeInTheDocument();
        expect(mocks.addDevice).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText('+ add'));
        fireEvent.click(screen.getByText('+ Delay Line'));

        // By id, not by the label on the button: `addDevice` matches on name
        // *or* id, and three catalog names are carried by two plugins each.
        expect(mocks.addDevice).toHaveBeenCalledWith('track-7', 'plug-1');
        expect(screen.queryByText('+ Delay Line')).not.toBeInTheDocument();
    });
});
