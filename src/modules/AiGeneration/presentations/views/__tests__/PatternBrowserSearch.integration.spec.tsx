import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PATTERN_TEMPLATES } from '../../../useCases/patternQueries/PATTERN_TEMPLATES';
import { PatternBrowser } from '../PatternBrowser';

describe('PatternBrowser search with the factory catalog', () => {
    it('filters rendered cards by a positive query and restores them when cleared', () => {
        render(<PatternBrowser />);

        const search = screen.getByRole('textbox', { name: 'Search MIDI patterns' });
        const insertButtons = () => screen.getAllByRole('button', { name: /^Insert / });

        expect(insertButtons()).toHaveLength(PATTERN_TEMPLATES.length);
        expect(screen.getByRole('button', { name: 'Insert 12-Bar Blues at playhead' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Insert 4-on-the-Floor at playhead' })).toBeInTheDocument();

        fireEvent.change(search, { target: { value: 'blues' } });

        expect(screen.getByRole('button', { name: 'Insert 12-Bar Blues at playhead' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Insert 4-on-the-Floor at playhead' })).not.toBeInTheDocument();
        expect(insertButtons().length).toBeLessThan(PATTERN_TEMPLATES.length);

        fireEvent.change(search, { target: { value: '' } });

        expect(insertButtons()).toHaveLength(PATTERN_TEMPLATES.length);
        expect(screen.getByRole('button', { name: 'Insert 12-Bar Blues at playhead' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Insert 4-on-the-Floor at playhead' })).toBeInTheDocument();
    });
});
