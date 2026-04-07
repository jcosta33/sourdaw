import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SamplerSection } from './SamplerSection';
import { DEFAULT_PATCH } from '../../models/FermenterPatch';

describe('SamplerSection', () => {
    it('should render', () => {
        const p = DEFAULT_PATCH;
        render(
            <SamplerSection mode={p.samplerMode} start={p.samplerStart} end={p.samplerEnd} onParam={vi.fn()} />
        );
        expect(screen.getByText(/sampler/i)).toBeInTheDocument();
    });
});
