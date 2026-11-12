import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_CRUST_PATCH } from '../../../models/CrustPatch';
import { CrustControlZone } from '../CrustControlZone';

describe('Crust rotary accessible names', () => {
    it('names timing knobs with the labels visible beneath them', () => {
        render(
            <CrustControlZone
                patch={{ ...DEFAULT_CRUST_PATCH, uiLevel: 2 }}
                setParam={vi.fn()}
                lufsIntegrated={-14}
                lufsShortTerm={-14}
                lufsMomentary={-14}
                lra={4}
                truepeakMax={-1}
                grDb={0}
            />
        );

        for (const name of ['Lookahead', 'Attack', 'Release']) {
            expect(screen.getByRole('slider', { name })).toBeInTheDocument();
        }
    });
});
