import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { MasterChannelStrip } from '../MasterChannelStrip';

import type { Track } from '../../../../models/TrackViewTypes';

const mocks = vi.hoisted(() => ({
    selectTrack: vi.fn<(trackId: string) => void>(),
    executeUserAppAction: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    selectTrack: mocks.selectTrack,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: mocks.executeUserAppAction,
}));

vi.mock('../MixerLevelReadout', () => ({
    MixerLevelReadout: ({ control }: { control: React.ReactNode }) => <div>{control}</div>,
}));

vi.mock('../MasterGainControl', () => ({
    MasterGainControl: () => <div data-testid="master-gain-control" />,
}));

function createMasterTrack(overrides: Partial<Track> = {}): Track {
    return {
        id: 'master',
        name: 'Master',
        kind: 'master',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#888888',
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
        height: 80,
        outputId: 'hw_out',
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
        ...overrides,
    };
}

const renderStrip = (props: { track?: Track; isSelected?: boolean }) =>
    render(
        <TooltipProvider>
            <MasterChannelStrip widthClass="w-28" {...props} />
        </TooltipProvider>
    );

describe('MasterChannelStrip track controls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('draws the selection ring only while the master is the selected track', () => {
        const { unmount } = renderStrip({ track: createMasterTrack(), isSelected: true });
        expect(screen.getByRole('group', { name: 'Master channel' })).toHaveClass('ring-1');
        unmount();

        renderStrip({ track: createMasterTrack(), isSelected: false });
        expect(screen.getByRole('group', { name: 'Master channel' })).not.toHaveClass('ring-1');
    });

    it('selects the master when the strip is clicked', () => {
        renderStrip({ track: createMasterTrack() });

        fireEvent.click(screen.getByRole('group', { name: 'Master channel' }));

        expect(mocks.selectTrack).toHaveBeenCalledExactlyOnceWith('master');
    });

    it('mutes the master through the channel mute action without selecting it', () => {
        renderStrip({ track: createMasterTrack() });

        fireEvent.click(screen.getByTestId('channel-mute-master'));

        expect(mocks.executeUserAppAction).toHaveBeenCalledExactlyOnceWith(
            { type: 'muteTrack', payload: { trackId: 'master', muted: true, expectedMuted: false } },
            { skipUndo: true }
        );
        expect(mocks.selectTrack).not.toHaveBeenCalled();
    });

    it('offers unmute while the master is muted', () => {
        renderStrip({ track: createMasterTrack({ muted: true }) });

        fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));

        expect(mocks.executeUserAppAction).toHaveBeenCalledExactlyOnceWith(
            { type: 'muteTrack', payload: { trackId: 'master', muted: false, expectedMuted: true } },
            { skipUndo: true }
        );
    });

    it('has no solo control', () => {
        renderStrip({ track: createMasterTrack() });

        expect(screen.queryByRole('button', { name: /solo/i })).not.toBeInTheDocument();
    });

    it('renders the gain strip without selection or mute when the project has no master row', () => {
        renderStrip({});

        expect(screen.getByTestId('master-gain-control')).toBeInTheDocument();
        expect(screen.queryByTestId('channel-mute-master')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('group', { name: 'Master channel' }));
        expect(mocks.selectTrack).not.toHaveBeenCalled();
    });
});
