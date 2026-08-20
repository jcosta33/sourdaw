import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DeviceChainSection } from '../DeviceChainSection';

import type { Device, Track } from '../../../../models/TrackViewTypes';

// Minimal local stand-in for Arrangement's PluginDescriptor — this module must not deep-import
// another module's models (AGENTS.md layer boundaries); only the fields the component reads.
type PluginStub = { id: string; name: string };

const mocks = vi.hoisted(() => ({
    selectTrack: vi.fn(),
    executeAppAction: vi.fn(),
    compileReorderDevicesAction: vi.fn(),
    getPlatformPlugins: vi.fn<() => PluginStub[]>(() => []),
    openInspector: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    selectTrack: mocks.selectTrack,
    compileReorderDevicesAction: mocks.compileReorderDevicesAction,
    getPlatformPlugins: mocks.getPlatformPlugins,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    pushUndoEntry: vi.fn(),
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

    it('toggles bypass on double-click through the action boundary', () => {
        const track: Track = { ...baseTrack, devices: [makeDevice({ id: 'dev-9', bypassed: false })] };
        render(<DeviceChainSection track={track} />);

        fireEvent.doubleClick(screen.getByText('Delay').closest('button')!);

        // The bypassDevice action is undoable; the raw use-case write this
        // replaced never entered history.
        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'bypassDevice',
            payload: { deviceId: 'dev-9', bypassed: true },
        });
    });

    it('removes a device via its remove button through the action boundary', () => {
        const track: Track = { ...baseTrack, devices: [makeDevice({ id: 'dev-9', name: 'Chorus' })] };
        render(<DeviceChainSection track={track} />);

        fireEvent.click(screen.getByLabelText('Remove Chorus'));

        // removeDevice is undoable via its restoreDevice inverse.
        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'removeDevice',
            payload: { deviceId: 'dev-9' },
        });
    });

    it('routes a device rack drag through the compiled reorder action', () => {
        const track: Track = {
            ...baseTrack,
            devices: [makeDevice({ id: 'dev-1', name: 'Delay' }), makeDevice({ id: 'dev-2', name: 'EQ' })],
        };
        const action = { type: 'reorderDevices', payload: { trackId: 'track-1' } };
        mocks.compileReorderDevicesAction.mockReturnValue(action);
        render(<DeviceChainSection track={track} />);

        const dragged = screen.getByText('Delay').closest('button');
        const target = screen.getByText('EQ').closest('button');
        if (!dragged || !target) {
            throw new Error('expected device rack buttons');
        }
        const dataTransfer = {
            effectAllowed: '',
            dropEffect: '',
            getData: vi.fn(() => 'dev-1'),
            setData: vi.fn(),
        };

        fireEvent.dragStart(dragged, { dataTransfer });
        fireEvent.drop(target, { dataTransfer });

        expect(mocks.compileReorderDevicesAction).toHaveBeenCalledWith('track-1', 'dev-1', 'dev-2');
        expect(mocks.executeAppAction).toHaveBeenCalledWith(action);
    });

    it('lists built-in plugins and MIDI FX after "+ add", dispatches the addDevice action on choice, and closes on cancel without dispatching', () => {
        mocks.getPlatformPlugins.mockReturnValue([{ id: 'plug-1', name: 'Delay Line' }]);
        const track: Track = { ...baseTrack, id: 'track-7' };
        render(<DeviceChainSection track={track} />);

        expect(screen.queryByText('+ Delay Line')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('+ add'));

        expect(screen.getByText('+ Delay Line')).toBeInTheDocument();
        expect(screen.getByText('♪ Chord Generator')).toBeInTheDocument();

        fireEvent.click(screen.getByText('cancel'));
        expect(screen.queryByText('+ Delay Line')).not.toBeInTheDocument();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText('+ add'));
        fireEvent.click(screen.getByText('+ Delay Line'));

        // By id, not by the label on the button: `addDevice` matches on name
        // *or* id, and three catalog names are carried by two plugins each.
        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'addDevice',
            payload: { trackId: 'track-7', deviceType: 'plug-1' },
        });
        expect(screen.queryByText('+ Delay Line')).not.toBeInTheDocument();

        // The MIDI FX menu passes the factory NAME (its id is not a catalog
        // device type), exactly as the raw call did.
        fireEvent.click(screen.getByText('+ add'));
        fireEvent.click(screen.getByText('♪ Chord Generator'));
        expect(mocks.executeAppAction).toHaveBeenLastCalledWith({
            type: 'addDevice',
            payload: { trackId: 'track-7', deviceType: 'Chord Generator' },
        });
    });
});
