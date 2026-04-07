import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnisonSection } from './UnisonSection';
import { DEFAULT_PATCH } from '../../models/FermenterPatch';

describe('UnisonSection', () => {
    it('should render', () => {
        const p = DEFAULT_PATCH;
        render(
            <UnisonSection
                voices={p.unisonVoices}
                detune={p.unisonDetune}
                spread={p.unisonSpread}
                onVoicesChange={vi.fn()}
                onDetuneChange={vi.fn()}
                onSpreadChange={vi.fn()}
            />
        );
        expect(screen.getByText(/unison/i)).toBeInTheDocument();
    });
});
