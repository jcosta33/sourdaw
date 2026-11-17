import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { bacteriaStore, DEFAULT_BACTERIA_STATE } from '../../../stores/bacteriaStore';
import { BacteriaPanel } from '../BacteriaPanel';

describe('BacteriaPanel', () => {
    beforeEach(() => {
        bacteriaStore.set({});
    });

    it('renders all three gain staging knobs and one set of band meters', () => {
        render(<BacteriaPanel deviceId="dev-1" />);

        for (const name of ['Input', 'Output', 'Mix']) {
            expect(screen.getByRole('slider', { name })).toBeInTheDocument();
        }
        expect(screen.getByText('Band energy')).toBeInTheDocument();
    });

    it('selects an effect for the sixth band and preserves the band across tier changes', () => {
        bacteriaStore.set({
            'dev-1': {
                ...DEFAULT_BACTERIA_STATE,
                patch: { ...DEFAULT_BACTERIA_STATE.patch, bandCount: 6 },
            },
        });
        render(<BacteriaPanel deviceId="dev-1" />);

        fireEvent.click(screen.getByRole('button', { name: 'Shape' }));
        fireEvent.click(screen.getByRole('button', { name: 'Band 6' }));
        fireEvent.click(screen.getByRole('button', { name: 'Body' }));
        expect(screen.getByRole('group', { name: 'Body' })).toBeInTheDocument();
        expect(
            within(screen.getByRole('grid', { name: 'Bands' })).getByRole('row', { name: 'Band 6' })
        ).toHaveAttribute('aria-selected', 'true');

        fireEvent.click(screen.getByRole('button', { name: 'Lab' }));
        expect(screen.getByRole('slider', { name: 'Speed' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Band 6' })).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(screen.getByRole('button', { name: 'Shape' }));
        expect(screen.getByRole('button', { name: 'Body' })).toHaveAttribute('aria-pressed', 'true');
    });
});
