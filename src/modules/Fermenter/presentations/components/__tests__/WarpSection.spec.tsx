import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WarpSection } from '../WarpSection';
import { DEFAULT_PATCH } from '../../../models/FermenterPatch';

describe('WarpSection', () => {
    it('should render', () => {
        const p = DEFAULT_PATCH;
        render(
            <WarpSection
                warpMode={p.warpMode}
                warpAmount={p.warpAmount}
                audioModRate={p.audioModRate}
                audioModDepth={p.audioModDepth}
                audioModTarget={p.audioModTarget}
                onParam={vi.fn()}
            />
        );
        expect(screen.getByText('Warp / Mod')).toBeInTheDocument();
    });
});
