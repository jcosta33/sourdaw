import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { CrumbsSection } from '../CrumbsSection';

describe('CrumbsSection', () => {
    it('should render', () => {
        const p = DEFAULT_PATCH;
        render(<CrumbsSection mode={p.samplerMode} start={p.samplerStart} end={p.samplerEnd} onParam={vi.fn()} />);
        expect(screen.getByText(/sampler/i)).toBeInTheDocument();
    });
});
