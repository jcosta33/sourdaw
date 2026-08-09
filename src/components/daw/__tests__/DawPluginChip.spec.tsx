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
    it.each([
        [true, true],
        [true, 'true'],
        [false, true],
        [false, 'true'],
    ] as const)('renders an inert chip differently from a live one (active=%s, aria-disabled=%s)', (active, marker) => {
        const { container } = render(
            <>
                <DawPluginChip active={active} aria-disabled={marker} title="Inert here.">
                    Gated
                </DawPluginChip>
                <DawPluginChip active={active}>Live</DawPluginChip>
            </>
        );

        const [gated, live] = [...container.querySelectorAll('button')];
        expect(gated?.className).not.toBe(live?.className);
    });

    /**
     * Hover feedback is a promise that the control will respond, so an inert
     * chip has to *lose* the hover styling rather than merely gain a dimmed
     * one.
     *
     * Expressed as a set relation between two renders — the inert chip's
     * classes must not be a superset of the live chip's — because the house
     * rule forbids asserting on class names and jsdom applies no CSS, so a
     * hover rule is otherwise unobservable. "It dropped something the live one
     * has" is the claim, and it names no token.
     *
     * Only for the non-active chip: an active chip legitimately keeps its whole
     * tone treatment and adds the dimming, so it *is* a superset by design.
     */
    it('drops the live chip’s hover affordance rather than only dimming it', () => {
        const { container } = render(
            <>
                <DawPluginChip aria-disabled title="Inert here.">
                    Gated
                </DawPluginChip>
                <DawPluginChip>Live</DawPluginChip>
            </>
        );

        const [gated, live] = [...container.querySelectorAll('button')];
        const gatedClasses = new Set((gated?.className ?? '').split(/\s+/));
        const dropped = (live?.className ?? '').split(/\s+/).filter((name) => !gatedClasses.has(name));

        expect(dropped.length).toBeGreaterThan(0);
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
