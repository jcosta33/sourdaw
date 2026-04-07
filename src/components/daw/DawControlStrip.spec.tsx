import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawControlStrip } from './DawControlStrip';

describe('DawControlStrip', () => {
    it('should render children', () => {
        render(<DawControlStrip>controls</DawControlStrip>);
        expect(screen.getByText('controls')).toBeInTheDocument();
    });
});
