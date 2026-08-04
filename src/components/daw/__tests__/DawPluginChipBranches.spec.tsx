import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DawPluginChip } from '../DawPluginChip';

function renderChip(props: Record<string, unknown> = {}) {
    const { container } = render(<DawPluginChip {...props}>Label</DawPluginChip>);
    return container.querySelector('button')!;
}

describe('DawPluginChip — active vs inactive', () => {
    it('active chip has active tone class (amber)', () => {
        const btn = renderChip({ active: true, tone: 'amber' });
        expect(btn.className).toContain('amber');
    });

    it('inactive chip has inactive styling (black/20)', () => {
        const btn = renderChip({ active: false, tone: 'amber' });
        expect(btn.className).toContain('black/20');
        expect(btn.className).not.toContain('accent-amber');
    });
});

describe('DawPluginChip — tone variants', () => {
    it('cyan tone applies cyan classes when active', () => {
        const btn = renderChip({ active: true, tone: 'cyan' });
        expect(btn.className).toContain('accent-cyan');
    });

    it('peach tone applies peach classes when active', () => {
        const btn = renderChip({ active: true, tone: 'peach' });
        expect(btn.className).toContain('accent-peach');
    });

    it('lavender tone applies lavender classes when active', () => {
        const btn = renderChip({ active: true, tone: 'lavender' });
        expect(btn.className).toContain('accent-lavender');
    });

    it('danger tone applies danger classes when active', () => {
        const btn = renderChip({ active: true, tone: 'danger' });
        expect(btn.className).toContain('state-danger');
    });
});

describe('DawPluginChip — size variants', () => {
    it('default size is xs', () => {
        const btn = renderChip();
        expect(btn.className).toContain('text-[7px]');
    });

    it('size sm renders larger text', () => {
        const btn = renderChip({ size: 'sm' });
        expect(btn.className).toContain('text-[10px]');
    });
});

describe('DawPluginChip — shape variants', () => {
    it('default shape is pill (rounded-full)', () => {
        const btn = renderChip();
        expect(btn.className).toContain('rounded-full');
    });

    it('shape soft renders rounded-[14px]', () => {
        const btn = renderChip({ shape: 'soft' });
        expect(btn.className).toContain('rounded-[14px]');
    });
});

describe('DawPluginChip — caps', () => {
    it('caps=true adds uppercase tracking', () => {
        const btn = renderChip({ caps: true });
        expect(btn.className).toContain('uppercase');
    });

    it('caps=false omits uppercase', () => {
        const btn = renderChip({ caps: false });
        expect(btn.className).not.toContain('uppercase');
    });
});

describe('DawPluginChip — children and onClick', () => {
    it('renders children text', () => {
        render(<DawPluginChip>Save</DawPluginChip>);
        expect(screen.getByText('Save')).toBeInTheDocument();
    });

    it('fires onClick', () => {
        const onClick = vi.fn();
        render(<DawPluginChip onClick={onClick}>X</DawPluginChip>);
        fireEvent.click(screen.getByText('X'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
