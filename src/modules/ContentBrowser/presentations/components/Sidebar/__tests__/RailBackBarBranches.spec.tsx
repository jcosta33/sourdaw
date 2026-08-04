import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { RailBackBar } from '../RailBackBar';

describe('RailBackBar — title and back button', () => {
    it('renders the title in uppercase', () => {
        render(<RailBackBar title="My Title" onBack={vi.fn()} />);
        expect(screen.getByText('My Title')).toBeInTheDocument();
    });

    it('calls onBack when back button clicked', () => {
        const onBack = vi.fn();
        render(<RailBackBar title="X" onBack={onBack} />);
        fireEvent.click(screen.getByRole('button'));
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});

describe('RailBackBar — optional icon', () => {
    it('renders an icon when the icon prop is provided', () => {
        const TestIcon = () => <svg data-testid="test-icon" />;
        render(<RailBackBar title="X" onBack={vi.fn()} icon={TestIcon} />);
        expect(screen.getByTestId('test-icon')).toBeInTheDocument();
    });

    it('does not render an icon when the icon prop is omitted', () => {
        render(<RailBackBar title="X" onBack={vi.fn()} />);
        expect(screen.queryByTestId('test-icon')).toBeNull();
    });
});
