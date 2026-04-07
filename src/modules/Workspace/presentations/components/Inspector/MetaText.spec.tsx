import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetaText } from './MetaText';

describe('MetaText', () => {
    it('should render children', () => {
        render(<MetaText>meta</MetaText>);
        expect(screen.getByText('meta')).toBeInTheDocument();
    });
});
