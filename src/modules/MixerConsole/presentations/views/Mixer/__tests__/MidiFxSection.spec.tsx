import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MidiFxSection } from '../MidiFxSection';

import type { Track } from '../../../../models/TrackViewTypes';

const mocks = vi.hoisted(() => ({
    addMidiFx: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addMidiFx: mocks.addMidiFx,
}));

const baseTrack: Track = {
    id: 'track-1',
    name: 'Track 1',
    kind: 'midi',
    muted: false,
    soloed: false,
    armed: false,
    gain: 0.8,
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
};

const makeTrack = (overrides: Partial<Track> = {}): Track => ({ ...baseTrack, ...overrides });

describe('MidiFxSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing for a non-midi track', () => {
        const { container } = render(<MidiFxSection track={makeTrack({ kind: 'audio' })} />);

        expect(container).toBeEmptyDOMElement();
    });

    it('lists the names of the fx already on a midi track', () => {
        render(
            <MidiFxSection
                track={makeTrack({
                    midiFx: [
                        { id: 'fx1', name: 'Arp One', type: 'arp', bypassed: false, parameterValues: {} },
                        { id: 'fx2', name: 'Vel Curve', type: 'velocity', bypassed: false, parameterValues: {} },
                    ],
                })}
            />
        );

        expect(screen.getByText(/Arp One/)).toBeInTheDocument();
        expect(screen.getByText(/Vel Curve/)).toBeInTheDocument();
    });

    it('shows the add-fx choices only after the add button is clicked', () => {
        render(<MidiFxSection track={makeTrack()} />);

        expect(screen.queryByText('+ Arpeggiator')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('+ add fx'));

        expect(screen.getByText('+ Arpeggiator')).toBeInTheDocument();
        expect(screen.getByText('+ Velocity')).toBeInTheDocument();
        expect(screen.getByText('+ Probability')).toBeInTheDocument();
    });

    it('dispatches addMidiFx with the track id, type, and label for the chosen fx', () => {
        render(<MidiFxSection track={makeTrack({ id: 'track-9' })} />);
        fireEvent.click(screen.getByText('+ add fx'));

        fireEvent.click(screen.getByText('+ Velocity'));

        expect(mocks.addMidiFx).toHaveBeenCalledWith('track-9', 'velocity', 'Velocity');
    });

    it('closes the add-fx choices after a choice is made', () => {
        render(<MidiFxSection track={makeTrack()} />);
        fireEvent.click(screen.getByText('+ add fx'));

        fireEvent.click(screen.getByText('+ Probability'));

        expect(screen.queryByText('+ Probability')).not.toBeInTheDocument();
        expect(screen.getByText('+ add fx')).toBeInTheDocument();
    });

    it('closes the add-fx choices on cancel without dispatching addMidiFx', () => {
        render(<MidiFxSection track={makeTrack()} />);
        fireEvent.click(screen.getByText('+ add fx'));

        fireEvent.click(screen.getByText('cancel'));

        expect(screen.queryByText('+ Arpeggiator')).not.toBeInTheDocument();
        expect(mocks.addMidiFx).not.toHaveBeenCalled();
    });
});
