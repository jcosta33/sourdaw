import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChoiceCard } from '../ChoiceCard';

describe('ChoiceCard', () => {
    it('should render children', () => {
        render(<ChoiceCard>Option</ChoiceCard>);
        expect(screen.getByText('Option')).toBeInTheDocument();
    });
});
