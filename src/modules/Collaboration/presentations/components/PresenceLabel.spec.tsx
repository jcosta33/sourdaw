import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PresenceLabel } from './PresenceLabel';

describe('PresenceLabel', () => {
    it('should render', () => {
        render(<PresenceLabel name="Bob" color="#444" edge="top" left={10} />);
        expect(screen.getByText('Bob')).toBeInTheDocument();
    });
});
