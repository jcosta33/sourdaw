import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { ChoiceCard } from '../ChoiceCard';

describe('ChoiceCard — children rendering', () => {
    it('renders children', () => {
        render(<ChoiceCard>Content</ChoiceCard>);
        expect(screen.getByText('Content')).toBeInTheDocument();
    });
});

describe('ChoiceCard — interactive prop', () => {
    it('passes onClick through spread props', () => {
        const onClick = vi.fn();
        render(<ChoiceCard onClick={onClick}>Click me</ChoiceCard>);
        fireEvent.click(screen.getByText('Click me'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders without onClick when interactive is false', () => {
        render(<ChoiceCard interactive={false}>Static</ChoiceCard>);
        expect(screen.getByText('Static')).toBeInTheDocument();
    });
});

describe('ChoiceCard — selected prop', () => {
    it('renders children when selected is true', () => {
        render(<ChoiceCard selected>Selected content</ChoiceCard>);
        expect(screen.getByText('Selected content')).toBeInTheDocument();
    });

    it('renders children when selected is false', () => {
        render(<ChoiceCard selected={false}>Unselected</ChoiceCard>);
        expect(screen.getByText('Unselected')).toBeInTheDocument();
    });
});

describe('ChoiceCard — native div props', () => {
    it('passes through data-testid', () => {
        render(<ChoiceCard data-testid="my-card">Test</ChoiceCard>);
        expect(screen.getByTestId('my-card')).toBeInTheDocument();
    });

    it('passes through aria-label', () => {
        render(<ChoiceCard aria-label="A card">Test</ChoiceCard>);
        expect(screen.getByLabelText('A card')).toBeInTheDocument();
    });
});
