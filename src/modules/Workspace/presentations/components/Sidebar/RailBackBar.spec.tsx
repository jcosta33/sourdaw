import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Piano } from 'lucide-react';
import { RailBackBar } from './RailBackBar';

describe('RailBackBar', () => {
    it('should render title and invoke onBack', () => {
        const onBack = vi.fn();
        render(<RailBackBar title="Presets" onBack={onBack} icon={Piano} />);
        expect(screen.getByText('Presets')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button'));
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});
