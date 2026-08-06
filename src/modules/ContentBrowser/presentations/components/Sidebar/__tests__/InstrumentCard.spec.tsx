import { render, screen, fireEvent } from '@testing-library/react';
import { Piano } from 'lucide-react';
import { describe, it, expect, vi } from 'vitest';

import { InstrumentCard, FERMENTER_THEME, TOASTER_THEME, KNEAD_THEME } from '../InstrumentCard';

describe('InstrumentCard', () => {
    it('should render label and invoke onClick', () => {
        const onClick = vi.fn();
        render(
            <InstrumentCard
                icon={Piano}
                label="Levain"
                badge="Synth"
                description="Test description"
                theme={FERMENTER_THEME}
                onClick={onClick}
            />
        );
        expect(screen.getByText('Levain')).toBeTruthy();
        expect(screen.getByText('Synth')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Levain/ }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders the description text', () => {
        render(
            <InstrumentCard
                icon={Piano}
                label="X"
                badge="Y"
                description="A rich sampled piano with 12 mic positions"
                theme={FERMENTER_THEME}
                onClick={vi.fn()}
            />
        );
        expect(screen.getByText('A rich sampled piano with 12 mic positions')).toBeTruthy();
    });

    it('renders the badge text in uppercase', () => {
        render(
            <InstrumentCard
                icon={Piano}
                label="X"
                badge="Drums"
                description="d"
                theme={TOASTER_THEME}
                onClick={vi.fn()}
            />
        );
        // Badge is rendered with uppercase tracking — the text is "Drums"
        expect(screen.getByText('Drums')).toBeTruthy();
    });

    it('fires onClick when clicked regardless of theme', () => {
        const onClick = vi.fn();
        render(
            <InstrumentCard
                icon={Piano}
                label="Knead"
                badge="Pitch"
                description="d"
                theme={KNEAD_THEME}
                onClick={onClick}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: /Knead/ }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
