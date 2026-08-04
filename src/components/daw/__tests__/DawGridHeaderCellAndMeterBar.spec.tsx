import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawGridHeaderCell } from '../DawGridHeaderCell';
import { DawMeterBar } from '../DawMeterBar';

describe('DawGridHeaderCell — children rendering', () => {
    it('renders children text', () => {
        render(<DawGridHeaderCell>Section A</DawGridHeaderCell>);
        expect(screen.getByText('Section A')).toBeInTheDocument();
    });
});

describe('DawGridHeaderCell — accentColor', () => {
    it('applies borderTopColor when accentColor is provided', () => {
        render(<DawGridHeaderCell accentColor="#ff0000">A</DawGridHeaderCell>);
        const cell = screen.getByText('A');
        expect(cell.style.borderTopColor).toBe('rgb(255, 0, 0)');
        expect(cell.style.borderTopWidth).toBe('2px');
    });

    it('does not apply borderTop when accentColor is omitted', () => {
        render(<DawGridHeaderCell>A</DawGridHeaderCell>);
        const cell = screen.getByText('A');
        expect(cell.style.borderTopColor).toBe('');
    });

    it('preserves custom style merged with accent', () => {
        render(
            <DawGridHeaderCell accentColor="#00ff00" style={{ color: 'white' }}>
                A
            </DawGridHeaderCell>
        );
        const cell = screen.getByText('A');
        expect(cell.style.color).toBe('white');
        expect(cell.style.borderTopColor).toBe('rgb(0, 255, 0)');
    });
});

describe('DawMeterBar — value rendering', () => {
    it('renders a fill div with width based on value', () => {
        const { container } = render(<DawMeterBar value={50} />);
        const fill = container.querySelector('[style*="width"]');
        expect(fill?.getAttribute('style')).toContain('50%');
    });

    it('default value is 0', () => {
        const { container } = render(<DawMeterBar />);
        const fill = container.querySelector('[style*="width"]');
        expect(fill?.getAttribute('style')).toContain('0%');
    });
});

describe('DawMeterBar — size variants', () => {
    it('default size is md (h-2)', () => {
        const { container } = render(<DawMeterBar />);
        expect(container.firstChild).toHaveProperty('className');
        expect((container.firstChild as HTMLElement).className).toContain('h-2');
    });

    it('size sm renders h-1.5', () => {
        const { container } = render(<DawMeterBar size="sm" />);
        expect((container.firstChild as HTMLElement).className).toContain('h-1.5');
    });
});
