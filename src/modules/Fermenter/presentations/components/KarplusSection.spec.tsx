import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KarplusSection } from './KarplusSection';
import { DEFAULT_PATCH } from '../../models/FermenterPatch';

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
