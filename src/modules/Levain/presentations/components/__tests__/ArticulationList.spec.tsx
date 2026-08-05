import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createDefaultPatch, type ArticulationEntry } from '../../../models/LevainPatch';
import { ArticulationList } from '../ArticulationList';

const entries: ArticulationEntry[] = [
    { type: 'sustain', keyswitch: 60, name: 'Long', enabled: true },
    { type: 'staccato', keyswitch: 61, name: 'Short', enabled: true },
    { type: 'pizzicato', keyswitch: null, name: 'Pluck', enabled: true },
    { type: 'tremolo', keyswitch: 62, name: 'Trem', enabled: false },
];

describe('ArticulationList', () => {
    it('should render', () => {
        const patch = createDefaultPatch('violin-1');
        render(
            <ArticulationList
                articulations={patch.articulations}
                current={patch.currentArticulation}
                grid
                onSelect={vi.fn()}
            />
        );
        expect(screen.getAllByText(/^Long$/).length).toBeGreaterThan(0);
    });

    it('calls onSelect with the articulation type when its card is clicked', () => {
        const patch = createDefaultPatch('violin-1');
        const target = patch.articulations.find((a) => a.type === 'staccato' && a.enabled);
        expect(target).toBeDefined();
        const onSelect = vi.fn();

        render(
            <ArticulationList
                articulations={patch.articulations}
                current={patch.currentArticulation}
                grid
                onSelect={onSelect}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /staccato/i }));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('staccato');
    });
});

describe('ArticulationList — enabled filter', () => {
    it('drops disabled articulations from the rendered list', () => {
        render(<ArticulationList articulations={entries} current="sustain" grid onSelect={vi.fn()} />);
        // 'Trem' is disabled → not rendered
        expect(screen.queryByText('Trem')).toBeNull();
        // Enabled ones are present
        expect(screen.getByText('Long')).toBeTruthy();
        expect(screen.getByText('Short')).toBeTruthy();
        expect(screen.getByText('Pluck')).toBeTruthy();
    });
});

describe('ArticulationList — keyswitch formatting (grid mode)', () => {
    it('renders the MIDI note name for entries with a keyswitch', () => {
        render(<ArticulationList articulations={entries} current="sustain" grid onSelect={vi.fn()} />);
        // keyswitch 60 → C4, 61 → C#4
        expect(screen.getByText('C4')).toBeTruthy();
        expect(screen.getByText('C#4')).toBeTruthy();
    });

    it('omits the keyswitch label when keyswitch is null', () => {
        render(<ArticulationList articulations={entries} current="sustain" grid onSelect={vi.fn()} />);
        // 'Pluck' (pizzicato) has null keyswitch — its button contains only the name, no note label
        const pluckButton = screen.getByRole('button', { name: /pluck/i });
        expect(pluckButton.textContent).toBe('Pluck');
    });
});

describe('ArticulationList — compact sidebar mode', () => {
    it('renders the "Articulations" header and per-row entries', () => {
        render(<ArticulationList articulations={entries} current="sustain" onSelect={vi.fn()} />);
        expect(screen.getByText('Articulations')).toBeTruthy();
        expect(screen.getByText('Long')).toBeTruthy();
        expect(screen.getByText('Short')).toBeTruthy();
        expect(screen.getByText('Pluck')).toBeTruthy();
    });

    it('renders keyswitch note names in compact mode', () => {
        render(<ArticulationList articulations={entries} current="sustain" onSelect={vi.fn()} />);
        expect(screen.getByText('C4')).toBeTruthy();
        expect(screen.getByText('C#4')).toBeTruthy();
    });

    it('fires onSelect with the correct type when a compact row is clicked', () => {
        const onSelect = vi.fn();
        render(<ArticulationList articulations={entries} current="sustain" onSelect={onSelect} />);
        fireEvent.click(screen.getByRole('button', { name: /short/i }));
        expect(onSelect).toHaveBeenCalledWith('staccato');
    });
});

describe('ArticulationList — active state routing', () => {
    it('routes onSelect with the clicked type regardless of which is current', () => {
        const onSelect = vi.fn();
        render(<ArticulationList articulations={entries} current="staccato" grid onSelect={onSelect} />);
        // Click the non-current articulation
        fireEvent.click(screen.getByRole('button', { name: /long/i }));
        expect(onSelect).toHaveBeenCalledWith('sustain');
        // Click the current articulation too — both are clickable
        fireEvent.click(screen.getByRole('button', { name: /short/i }));
        expect(onSelect).toHaveBeenCalledWith('staccato');
    });
});
