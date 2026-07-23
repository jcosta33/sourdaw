import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrackMidiFxSection } from '../TrackMidiFxSection';

import type { Track, MidiFx } from '../../../../models/TrackViewTypes';

const mockAddMidiFx = vi.fn<(trackId: string, type: string, name: string) => void>();
const mockRemoveMidiFx = vi.fn<(trackId: string, fxId: string) => void>();
const mockBypassMidiFx = vi.fn<(trackId: string, fxId: string, bypassed: boolean) => void>();
const mockUpdateMidiFxParam = vi.fn<(trackId: string, fxId: string, paramId: string, value: number) => void>();

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        addMidiFx: (trackId: string, type: string, name: string): void => {
            mockAddMidiFx(trackId, type, name);
        },
        removeMidiFx: (trackId: string, fxId: string): void => {
            mockRemoveMidiFx(trackId, fxId);
        },
        bypassMidiFx: (trackId: string, fxId: string, bypassed: boolean): void => {
            mockBypassMidiFx(trackId, fxId, bypassed);
        },
        updateMidiFxParam: (trackId: string, fxId: string, paramId: string, value: number): void => {
            mockUpdateMidiFxParam(trackId, fxId, paramId, value);
        },
    };
});

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, actions }: { title?: string; actions?: React.ReactNode }) => (
        <div data-testid="header-band">
            <span>{title}</span>
            {actions ? <div data-testid="header-actions">{actions}</div> : null}
        </div>
    ),
}));

vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
        <button data-testid="knob" data-value={value} onClick={() => onChange(0.5)}>
            knob
        </button>
    ),
}));

vi.mock('lucide-react', () => ({
    Power: (props: { className?: string }) => <span data-testid="icon-power" className={props.className} />,
    Trash2: () => <span data-testid="icon-trash" />,
    Settings2: () => <span data-testid="icon-settings" />,
}));

const makeTrack = (midiFx: MidiFx[], kind: Track['kind'] = 'midi'): Track => ({
    id: 'track-1',
    name: 'Test Track',
    kind,
    muted: false,
    soloed: false,
    armed: false,
    gain: 1,
    pan: 0,
    color: '#ff0000',
    clips: [],
    devices: [],
    midiFx,
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

const arpFx: MidiFx = { id: 'fx-arp', name: 'Arpeggiator', type: 'arp', bypassed: false, parameterValues: {} };
const velocityFx: MidiFx = { id: 'fx-vel', name: 'Velocity', type: 'velocity', bypassed: false, parameterValues: {} };
const probabilityFx: MidiFx = {
    id: 'fx-prob',
    name: 'Probability',
    type: 'probability',
    bypassed: true,
    parameterValues: {},
};

describe('TrackMidiFxSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render null for a non-midi track', () => {
        const { container } = render(<TrackMidiFxSection track={makeTrack([], 'audio')} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('should render the MIDI FX header for a midi track', () => {
        render(<TrackMidiFxSection track={makeTrack([])} />);
        expect(screen.getByText('MIDI FX')).toBeInTheDocument();
    });

    it('should add an arpeggiator when + ARP is clicked', () => {
        render(<TrackMidiFxSection track={makeTrack([])} />);
        fireEvent.click(screen.getByRole('button', { name: '+ ARP' }));
        expect(mockAddMidiFx).toHaveBeenCalledWith('track-1', 'arp', 'Arpeggiator');
    });

    it('should add a velocity fx when + VEL is clicked', () => {
        render(<TrackMidiFxSection track={makeTrack([])} />);
        fireEvent.click(screen.getByRole('button', { name: '+ VEL' }));
        expect(mockAddMidiFx).toHaveBeenCalledWith('track-1', 'velocity', 'Velocity');
    });

    it('should add a probability fx when + PROB is clicked', () => {
        render(<TrackMidiFxSection track={makeTrack([])} />);
        fireEvent.click(screen.getByRole('button', { name: '+ PROB' }));
        expect(mockAddMidiFx).toHaveBeenCalledWith('track-1', 'probability', 'Probability');
    });

    it('should render each midi fx name', () => {
        render(<TrackMidiFxSection track={makeTrack([arpFx, velocityFx])} />);
        expect(screen.getByText('Arpeggiator')).toBeInTheDocument();
        expect(screen.getByText('Velocity')).toBeInTheDocument();
    });

    it('should toggle bypass with the inverse of the current state', () => {
        render(<TrackMidiFxSection track={makeTrack([arpFx])} />);
        const bypassButton = screen.getByTestId('icon-power').closest('button');
        if (!bypassButton) {
            throw new Error('expected a bypass button');
        }
        fireEvent.click(bypassButton);
        expect(mockBypassMidiFx).toHaveBeenCalledWith('track-1', 'fx-arp', true);
    });

    it('should toggle bypass on for an already-bypassed fx', () => {
        render(<TrackMidiFxSection track={makeTrack([probabilityFx])} />);
        const bypassButton = screen.getByTestId('icon-power').closest('button');
        if (!bypassButton) {
            throw new Error('expected a bypass button');
        }
        fireEvent.click(bypassButton);
        expect(mockBypassMidiFx).toHaveBeenCalledWith('track-1', 'fx-prob', false);
    });

    it('should remove the fx when the trash button is clicked', () => {
        render(<TrackMidiFxSection track={makeTrack([arpFx])} />);
        const removeButton = screen.getByTestId('icon-trash').closest('button');
        if (!removeButton) {
            throw new Error('expected a remove button');
        }
        fireEvent.click(removeButton);
        expect(mockRemoveMidiFx).toHaveBeenCalledWith('track-1', 'fx-arp');
    });

    it('should apply reduced opacity to a bypassed fx card', () => {
        render(<TrackMidiFxSection track={makeTrack([probabilityFx])} />);
        expect(screen.getByText('Probability').closest('.opacity-50')).not.toBeNull();
    });

    it('should default the arp rate knob and update it on change', () => {
        render(<TrackMidiFxSection track={makeTrack([arpFx])} />);
        const knob = screen.getByTestId('knob');
        expect(knob.getAttribute('data-value')).toBe('0.25');
        fireEvent.click(knob);
        expect(mockUpdateMidiFxParam).toHaveBeenCalledWith('track-1', 'fx-arp', 'rate', 0.5);
    });

    it('should update the arp mode from the select', () => {
        render(<TrackMidiFxSection track={makeTrack([arpFx])} />);
        const select = screen.getByRole('combobox');
        expect((select as HTMLSelectElement).value).toBe('0');
        fireEvent.change(select, { target: { value: '3' } });
        expect(mockUpdateMidiFxParam).toHaveBeenCalledWith('track-1', 'fx-arp', 'mode', 3);
    });

    it('should default and update the velocity scale and offset knobs', () => {
        render(<TrackMidiFxSection track={makeTrack([velocityFx])} />);
        const knobs = screen.getAllByTestId('knob');
        expect(knobs[0]?.getAttribute('data-value')).toBe('1');
        expect(knobs[1]?.getAttribute('data-value')).toBe('0');
        fireEvent.click(knobs[0] as HTMLElement);
        expect(mockUpdateMidiFxParam).toHaveBeenCalledWith('track-1', 'fx-vel', 'scale', 0.5);
        fireEvent.click(knobs[1] as HTMLElement);
        expect(mockUpdateMidiFxParam).toHaveBeenCalledWith('track-1', 'fx-vel', 'offset', 0.5);
    });

    it('should default and update the probability seed knob', () => {
        render(<TrackMidiFxSection track={makeTrack([probabilityFx])} />);
        const knob = screen.getByTestId('knob');
        expect(knob.getAttribute('data-value')).toBe('12345');
        fireEvent.click(knob);
        expect(mockUpdateMidiFxParam).toHaveBeenCalledWith('track-1', 'fx-prob', 'seed', 0.5);
    });

    it('should honour existing arp parameter values over defaults', () => {
        const configured: MidiFx = { ...arpFx, parameterValues: { rate: 0.75, mode: 2 } };
        render(<TrackMidiFxSection track={makeTrack([configured])} />);
        expect(screen.getByTestId('knob').getAttribute('data-value')).toBe('0.75');
        expect(screen.getByRole('combobox')).toHaveValue('2');
    });
});
