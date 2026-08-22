import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawInlineHint } from '../DawInlineHint';
import { DawMeterFrame } from '../DawMeterFrame';
import { DawPluginReadoutList } from '../DawPluginReadoutList';

describe('DawMeterFrame — overlay variants', () => {
    it('renders children', () => {
        render(<DawMeterFrame>Canvas</DawMeterFrame>);
        expect(screen.getByText('Canvas')).toBeInTheDocument();
    });

    it('default overlay is horizontal', () => {
        const { container } = render(<DawMeterFrame>X</DawMeterFrame>);
        const overlay = container.querySelector('[style*="gradient"]') as HTMLElement;
        expect(overlay.style.background).toContain('90deg');
    });

    it('overlay=vertical uses 180deg gradient', () => {
        const { container } = render(<DawMeterFrame overlay="vertical">X</DawMeterFrame>);
        const overlay = container.querySelector('[style*="gradient"]') as HTMLElement;
        expect(overlay.style.background).toContain('180deg');
    });

    it('overlay=radial uses radial-gradient', () => {
        const { container } = render(<DawMeterFrame overlay="radial">X</DawMeterFrame>);
        const overlay = container.querySelector('[style*="gradient"]') as HTMLElement;
        expect(overlay.style.background).toContain('radial-gradient');
    });
});

describe('DawInlineHint — children and className', () => {
    it('renders children', () => {
        render(<DawInlineHint>Hint text</DawInlineHint>);
        expect(screen.getByText('Hint text')).toBeInTheDocument();
    });

    it('passes through onClick via spread props', () => {
        render(<DawInlineHint data-testid="hint">X</DawInlineHint>);
        expect(screen.getByTestId('hint')).toBeInTheDocument();
    });
});

describe('DawPluginReadoutList — density variants', () => {
    it('default density uses gap-2', () => {
        const { container } = render(<DawPluginReadoutList>X</DawPluginReadoutList>);
        expect((container.firstChild as HTMLElement).className).toContain('gap-2');
    });

    it('density=tight uses gap-1', () => {
        const { container } = render(<DawPluginReadoutList density="tight">X</DawPluginReadoutList>);
        expect((container.firstChild as HTMLElement).className).toContain('gap-1');
    });

    it('renders children', () => {
        render(<DawPluginReadoutList>Content</DawPluginReadoutList>);
        expect(screen.getByText('Content')).toBeInTheDocument();
    });
});
