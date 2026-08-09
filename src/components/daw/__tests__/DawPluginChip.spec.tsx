import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DawPluginChip } from '../DawPluginChip';

describe('DawPluginChip', () => {
    it('should render active tone and click', () => {
        const onClick = vi.fn();
        render(
            <DawPluginChip active tone="cyan" onClick={onClick}>
                Edit
            </DawPluginChip>
        );
        expect(screen.getByRole('button', { name: 'Edit' })).toHaveClass('text-[var(--color-accent-cyan)]');
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalled();
    });

    /**
     * An `aria-disabled` chip has to *look* different from a live one.
     *
     * The disabled styling used to be keyed on the native `disabled` attribute
     * alone, while every gated chip in the app is marked with `aria-disabled`
     * so it stays focusable and can carry its own explanation. The two never
     * met: a gated chip rendered pixel-identical to a live one and quietly ate
     * the click. Both the Dutch Oven's `GatedChip` and Gluten's `ToggleChip`
     * were affected.
     *
     * Asserted as a *comparison* rather than against a class name. The house
     * rule forbids asserting on styling hooks, and rightly — a Tailwind
     * substring breaks on every theme change and proves nothing about what a
     * user sees. "These two must not render identically" survives a rewrite of
     * the styling and is the actual claim.
     */
    it.each([true, false])('renders an inert chip differently from a live one (active=%s)', (active) => {
        const { container } = render(
            <>
                <DawPluginChip active={active} aria-disabled title="Inert here.">
                    Gated
                </DawPluginChip>
                <DawPluginChip active={active}>Live</DawPluginChip>
            </>
        );

        const [gated, live] = [...container.querySelectorAll('button')];
        expect(gated?.className).not.toBe(live?.className);
    });

    it('treats aria-disabled="false" as live', () => {
        const { container } = render(
            <>
                <DawPluginChip aria-disabled="false">Explicitly live</DawPluginChip>
                <DawPluginChip>Live</DawPluginChip>
            </>
        );

        const [explicit, live] = [...container.querySelectorAll('button')];
        expect(explicit?.className).toBe(live?.className);
    });
});
