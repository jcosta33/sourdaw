import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { PresenceLabel } from '../PresenceLabel';

describe('PresenceLabel — rendering', () => {
    it('renders the name text', () => {
        render(<PresenceLabel name="Alice" color="#ff0000" edge="top" left={10} />);
        expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    it('applies color as backgroundColor via inline style', () => {
        render(<PresenceLabel name="Bob" color="#00ff00" edge="top" left={5} />);
        const label = screen.getByText('Bob');
        expect(label.style.backgroundColor).toBe('rgb(0, 255, 0)');
    });
});

describe('PresenceLabel — edge positioning', () => {
    it('uses top-0 class for edge="top"', () => {
        render(<PresenceLabel name="A" color="#fff" edge="top" left={0} />);
        const label = screen.getByText('A');
        expect(label.className).toContain('top-0');
    });

    it('uses bottom-1 class for edge="bottom"', () => {
        render(<PresenceLabel name="A" color="#fff" edge="bottom" left={0} />);
        const label = screen.getByText('A');
        expect(label.className).toContain('bottom-1');
    });
});

describe('PresenceLabel — offset and opacity', () => {
    it('default offset is 3 (left = left + offset)', () => {
        render(<PresenceLabel name="A" color="#fff" edge="top" left={10} />);
        const label = screen.getByText('A');
        expect(label.style.left).toBe('13px');
    });

    it('custom offset overrides default', () => {
        render(<PresenceLabel name="A" color="#fff" edge="top" left={10} offset={10} />);
        const label = screen.getByText('A');
        expect(label.style.left).toBe('20px');
    });

    it('default opacity is 0.9', () => {
        render(<PresenceLabel name="A" color="#fff" edge="top" left={0} />);
        const label = screen.getByText('A');
        expect(label.style.opacity).toBe('0.9');
    });

    it('custom opacity overrides default', () => {
        render(<PresenceLabel name="A" color="#fff" edge="top" left={0} opacity={0.5} />);
        const label = screen.getByText('A');
        expect(label.style.opacity).toBe('0.5');
    });
});
