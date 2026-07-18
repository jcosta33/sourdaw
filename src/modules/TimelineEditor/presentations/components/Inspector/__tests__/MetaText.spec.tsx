import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { MetaText } from '../MetaText';

describe('MetaText', () => {
    it('should render children', () => {
        render(<MetaText>meta</MetaText>);
        expect(screen.getByText('meta')).toBeInTheDocument();
    });
});
