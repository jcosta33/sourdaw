import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { LatchButton } from '../LatchButton';

describe('LatchButton — active state', () => {
    it('reflects active=true on data-active', () => {
        render(<LatchButton active>Solo</LatchButton>);
        expect(screen.getByRole('button', { name: 'Solo' })).toHaveAttribute('data-active', 'true');
    });

    it('reflects active=false on data-active', () => {
        render(<LatchButton active={false}>Mute</LatchButton>);
        expect(screen.getByRole('button', { name: 'Mute' })).toHaveAttribute('data-active', 'false');
    });

    it('defaults to inactive when active is omitted', () => {
        render(<LatchButton>Rec</LatchButton>);
        expect(screen.getByRole('button', { name: 'Rec' })).toHaveAttribute('data-active', 'false');
    });
});

describe('LatchButton — active vs inactive styling', () => {
    it('applies the sunken/inset style when active', () => {
        render(<LatchButton active>Test</LatchButton>);
        const btn = screen.getByRole('button', { name: 'Test' });
        const style = btn.style;
        // Active reverses the semantic ramp from default to raised.
        expect(style.background.indexOf('var(--surface-default)')).toBeLessThan(
            style.background.indexOf('var(--surface-raised)')
        );
        // Active has inset shadow.
        expect(style.boxShadow).toContain('inset');
        // Active sinks down 1px.
        expect(style.transform).toBe('translateY(1px)');
    });

    it('applies the raised style when inactive', () => {
        render(<LatchButton active={false}>Test</LatchButton>);
        const btn = screen.getByRole('button', { name: 'Test' });
        const style = btn.style;
        // Inactive runs the semantic ramp from raised to default.
        expect(style.background.indexOf('var(--surface-raised)')).toBeLessThan(
            style.background.indexOf('var(--surface-default)')
        );
        // Inactive has a drop shadow (not inset-only).
        expect(style.boxShadow).toContain('0 2px 4px');
        // Inactive does not translate.
        expect(style.transform).toBe('');
    });
});

describe('LatchButton — variant glow', () => {
    it('applies the red variant glow shadow when active', () => {
        render(
            <LatchButton active variant="red">
                Rec
            </LatchButton>
        );
        const btn = screen.getByRole('button', { name: 'Rec' });
        // The red variant adds a red-tinted glow.
        expect(btn.style.boxShadow).toContain('rgba(255,64,50');
    });

    it('applies the cyan variant glow shadow when active', () => {
        render(
            <LatchButton active variant="cyan">
                Sync
            </LatchButton>
        );
        const btn = screen.getByRole('button', { name: 'Sync' });
        expect(btn.style.boxShadow).toContain('rgba(127,184,196');
    });

    it('applies no extra glow for the neutral variant when active', () => {
        render(
            <LatchButton active variant="neutral">
                OK
            </LatchButton>
        );
        const btn = screen.getByRole('button', { name: 'OK' });
        // Neutral has no glow — boxShadow ends after the inset shadows.
        expect(btn.style.boxShadow).not.toContain('0 0 8px');
    });

    it('applies the active text color class for the variant when active', () => {
        render(
            <LatchButton active variant="amber">
                Solo
            </LatchButton>
        );
        const btn = screen.getByRole('button', { name: 'Solo' });
        expect(btn.querySelector('span')!.className).toContain('text-state-solo');
    });

    it('applies the muted text class when inactive', () => {
        render(
            <LatchButton active={false} variant="amber">
                Solo
            </LatchButton>
        );
        const btn = screen.getByRole('button', { name: 'Solo' });
        expect(btn.querySelector('span')!.className).toContain('text-text-secondary');
    });
});

describe('LatchButton — sizes', () => {
    it('applies the md size class by default', () => {
        render(<LatchButton>Test</LatchButton>);
        expect(screen.getByRole('button', { name: 'Test' }).className).toContain('h-8');
    });

    it('applies the sm size class when size="sm"', () => {
        render(<LatchButton size="sm">Test</LatchButton>);
        expect(screen.getByRole('button', { name: 'Test' }).className).toContain('h-6');
    });

    it('applies the icon size class when size="icon"', () => {
        render(<LatchButton size="icon">X</LatchButton>);
        expect(screen.getByRole('button', { name: 'X' }).className).toContain('size-6');
    });
});

describe('LatchButton — interaction', () => {
    it('invokes onClick', () => {
        const onClick = vi.fn();
        render(
            <LatchButton active={false} onClick={onClick}>
                Tap
            </LatchButton>
        );
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
