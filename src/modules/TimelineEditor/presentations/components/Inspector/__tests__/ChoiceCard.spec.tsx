import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ChoiceCard } from '../ChoiceCard';

describe('ChoiceCard', () => {
    it('should render children', () => {
        render(<ChoiceCard>Option</ChoiceCard>);
        expect(screen.getByText('Option')).toBeInTheDocument();
    });
});
