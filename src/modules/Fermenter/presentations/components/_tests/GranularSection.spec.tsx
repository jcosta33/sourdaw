import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GranularSection } from '../GranularSection';
import { DEFAULT_PATCH } from '../../../models/FermenterPatch';

describe('GranularSection', () => {
    it('should render', () => {
        const p = DEFAULT_PATCH;
        render(
            <GranularSection
                density={p.grainDensity}
                size={p.grainSize}
                position={p.grainPosition}
                spray={p.grainSpray}
                pitchVar={p.grainPitchVar}
                panSpread={p.grainPanSpread}
                onParam={vi.fn()}
            />
        );
        expect(screen.getByText(/grain cloud/i)).toBeInTheDocument();
    });
});
