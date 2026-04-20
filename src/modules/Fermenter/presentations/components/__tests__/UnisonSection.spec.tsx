import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { UnisonSection } from '../UnisonSection';

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
