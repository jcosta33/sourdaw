import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DawCompactCheckbox } from '../DawCompactCheckbox';
import { DawKeycap } from '../DawKeycap';
import { DawSwatchButton } from '../DawSwatchButton';

describe('DawSwatchButton — color and active state', () => {
    it('renders with the provided color as backgroundColor', () => {
        render(<DawSwatchButton color="#ff0000" />);
        const btn = screen.getByRole('button');
        expect(btn.style.backgroundColor).toBe('rgb(255, 0, 0)');
    });

    it('active state adds ring class', () => {
        render(<DawSwatchButton color="#00ff00" active />);
        expect(screen.getByRole('button').className).toContain('ring-2');
    });

    it('inactive state does not have ring-2', () => {
        render(<DawSwatchButton color="#00ff00" active={false} />);
        expect(screen.getByRole('button').className).not.toContain('ring-2');
    });

    it('size sm renders size-3.5 class', () => {
        render(<DawSwatchButton color="#fff" size="sm" />);
        expect(screen.getByRole('button').className).toContain('size-3.5');
    });

    it('size md renders size-4.5 class', () => {
        render(<DawSwatchButton color="#fff" size="md" />);
        expect(screen.getByRole('button').className).toContain('size-4.5');
    });

    it('fires onClick', () => {
        const onClick = vi.fn();
        render(<DawSwatchButton color="#fff" onClick={onClick} />);
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});

describe('DawCompactCheckbox — checked state and onChange', () => {
    it('renders as a checkbox input', () => {
        render(<DawCompactCheckbox checked readOnly />);
        expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });

    it('fires onChange when toggled', () => {
        const onChange = vi.fn();
        render(<DawCompactCheckbox onChange={onChange} />);
        fireEvent.click(screen.getByRole('checkbox'));
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('checked prop reflects state', () => {
        render(<DawCompactCheckbox checked readOnly />);
        expect(screen.getByRole('checkbox')).toBeChecked();
    });
});

describe('DawKeycap — compact mode and children', () => {
    it('renders children text', () => {
        render(<DawKeycap>Ctrl</DawKeycap>);
        expect(screen.getByText('Ctrl')).toBeInTheDocument();
    });

    it('compact=false adds py-1', () => {
        const { container } = render(<DawKeycap>A</DawKeycap>);
        expect(container.querySelector('kbd')!.className).toContain('py-1');
    });

    it('compact=true adds py-0.5', () => {
        const { container } = render(<DawKeycap compact>A</DawKeycap>);
        expect(container.querySelector('kbd')!.className).toContain('py-0.5');
    });
});
