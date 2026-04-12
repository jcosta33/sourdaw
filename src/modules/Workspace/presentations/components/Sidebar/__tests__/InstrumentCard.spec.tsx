import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Piano } from 'lucide-react';
import { InstrumentCard, FERMENTER_THEME } from '../InstrumentCard';

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
        expect(screen.getByText('Levain')).toBeInTheDocument();
        expect(screen.getByText('Synth')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Levain/ }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
