import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrumbsSection } from '../CrumbsSection';
import { DEFAULT_PATCH } from '../../../models/FermenterPatch';

describe('CrumbsSection', () => {
    it('should render', () => {
        const p = DEFAULT_PATCH;
        render(
            <CrumbsSection mode={p.samplerMode} start={p.samplerStart} end={p.samplerEnd} onParam={vi.fn()} />
        );
        expect(screen.getByText(/sampler/i)).toBeInTheDocument();
    });
});
