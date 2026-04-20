import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { GranularSection } from '../GranularSection';

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
