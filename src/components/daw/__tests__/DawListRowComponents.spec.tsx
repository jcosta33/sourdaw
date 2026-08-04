import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DawPluginChoiceRow } from '../DawPluginChoiceRow';
import { DawUtilityListRow } from '../DawUtilityListRow';

describe('DawUtilityListRow — title and subtitle', () => {
    it('renders title text', () => {
        render(<DawUtilityListRow title="Kick" />);
        expect(screen.getByText('Kick')).toBeInTheDocument();
    });

    it('renders subtitle when provided', () => {
        render(<DawUtilityListRow title="Kick" subtitle="808" />);
        expect(screen.getByText('808')).toBeInTheDocument();
    });

    it('does not render subtitle when omitted', () => {
        render(<DawUtilityListRow title="Kick" />);
        expect(screen.queryByText('808')).toBeNull();
    });
});

describe('DawUtilityListRow — slots', () => {
    it('renders startSlot when provided', () => {
        render(<DawUtilityListRow title="X" startSlot={<span data-testid="icon">I</span>} />);
        expect(screen.getByTestId('icon')).toBeInTheDocument();
    });

    it('renders endSlot when provided', () => {
        render(<DawUtilityListRow title="X" endSlot={<span data-testid="badge">B</span>} />);
        expect(screen.getByTestId('badge')).toBeInTheDocument();
    });
});

describe('DawUtilityListRow — onPress (interactive vs non-interactive)', () => {
    it('renders a button when onPress is provided', () => {
        render(<DawUtilityListRow title="X" onPress={vi.fn()} />);
        expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('renders a div (no role=button) when onPress is omitted', () => {
        const { container } = render(<DawUtilityListRow title="X" />);
        expect(container.querySelector('button')).toBeNull();
    });

    it('fires onPress when clicked', () => {
        const onPress = vi.fn();
        render(<DawUtilityListRow title="X" onPress={onPress} />);
        fireEvent.click(screen.getByRole('button'));
        expect(onPress).toHaveBeenCalledTimes(1);
    });
});

describe('DawPluginChoiceRow — title and detail', () => {
    it('renders title text', () => {
        render(<DawPluginChoiceRow title="Reverb" />);
        expect(screen.getByText('Reverb')).toBeInTheDocument();
    });

    it('renders detail when provided', () => {
        render(<DawPluginChoiceRow title="Reverb" detail="Hall" />);
        expect(screen.getByText('Hall')).toBeInTheDocument();
    });

    it('renders subtitle when provided', () => {
        render(<DawPluginChoiceRow title="Reverb" subtitle="Long decay" />);
        expect(screen.getByText('Long decay')).toBeInTheDocument();
    });
});

describe('DawPluginChoiceRow — active state and onPress', () => {
    it('active=true adds active class', () => {
        const { container } = render(<DawPluginChoiceRow title="X" active />);
        expect(container.firstChild).toHaveProperty('className');
        expect((container.firstChild as HTMLElement).className).toContain('bg-white');
    });

    it('renders a button when onPress is provided', () => {
        render(<DawPluginChoiceRow title="X" onPress={vi.fn()} />);
        expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('fires onPress when clicked', () => {
        const onPress = vi.fn();
        render(<DawPluginChoiceRow title="X" onPress={onPress} />);
        fireEvent.click(screen.getByRole('button'));
        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('passes through aria-label', () => {
        render(<DawPluginChoiceRow title="X" aria-label="Choose reverb" onPress={vi.fn()} />);
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Choose reverb');
    });
});
