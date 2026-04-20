import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { KarplusSection } from '../KarplusSection';

describe('KarplusSection', () => {
    it('should render', () => {
        const p = DEFAULT_PATCH;
        render(
            <KarplusSection
                damping={p.ksDamping}
                brightness={p.ksBrightness}
                onDampingChange={vi.fn()}
                onBrightnessChange={vi.fn()}
            />
        );
        expect(screen.getByText(/string model/i)).toBeInTheDocument();
    });
});
