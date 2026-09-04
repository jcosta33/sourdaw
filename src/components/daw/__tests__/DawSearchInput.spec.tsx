import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DawSearchInput } from '../DawSearchInput';

describe('DawSearchInput', () => {
    it('renders with search icon, placeholder, and ARIA label', () => {
        const { container } = render(
            <DawSearchInput value="" onChange={vi.fn()} placeholder="Search presets..." aria-label="Search presets" />
        );

        const input = screen.getByRole('searchbox', { name: 'Search presets' });
        expect(input).toBeInTheDocument();
        expect(input).toHaveAttribute('placeholder', 'Search presets...');

        const icon = container.querySelector('svg');
        expect(icon).toBeInTheDocument();
        expect(icon).toHaveAttribute('aria-hidden', 'true');
        expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    });

    it('fires onChange when user types into the input', () => {
        const onChange = vi.fn();
        render(<DawSearchInput value="" onChange={onChange} aria-label="Search" />);

        const input = screen.getByRole('searchbox', { name: 'Search' });
        fireEvent.change(input, { target: { value: 'sourdough' } });

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('sourdough');
    });

    it('shows clear button when value is non-empty and hides it when empty', () => {
        const { rerender } = render(<DawSearchInput value="" onChange={vi.fn()} aria-label="Search" />);
        expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();

        rerender(<DawSearchInput value="active query" onChange={vi.fn()} aria-label="Search" />);
        expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();

        rerender(<DawSearchInput value="" onChange={vi.fn()} aria-label="Search" />);
        expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    });

    it('clicking clear button calls onChange("") and onClear', () => {
        const onChange = vi.fn();
        const onClear = vi.fn();

        render(<DawSearchInput value="ferment" onChange={onChange} onClear={onClear} aria-label="Search" />);

        const clearButton = screen.getByRole('button', { name: 'Clear search' });
        fireEvent.click(clearButton);

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('');
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('pressing Escape when focused and non-empty calls onChange("") and onClear', () => {
        const onChange = vi.fn();
        const onClear = vi.fn();
        const onKeyDown = vi.fn();

        render(
            <DawSearchInput
                value="starter"
                onChange={onChange}
                onClear={onClear}
                onKeyDown={onKeyDown}
                aria-label="Search"
            />
        );

        const input = screen.getByRole('searchbox', { name: 'Search' });
        fireEvent.keyDown(input, { key: 'Escape' });

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('');
        expect(onClear).toHaveBeenCalledTimes(1);
        expect(onKeyDown).toHaveBeenCalledTimes(1);
    });

    it('pressing Escape when empty does not trigger onChange or onClear', () => {
        const onChange = vi.fn();
        const onClear = vi.fn();
        const onKeyDown = vi.fn();

        render(
            <DawSearchInput value="" onChange={onChange} onClear={onClear} onKeyDown={onKeyDown} aria-label="Search" />
        );

        const input = screen.getByRole('searchbox', { name: 'Search' });
        fireEvent.keyDown(input, { key: 'Escape' });

        expect(onChange).not.toHaveBeenCalled();
        expect(onClear).not.toHaveBeenCalled();
        expect(onKeyDown).toHaveBeenCalledTimes(1);
    });

    it('renders with size="micro" and size="sm"', () => {
        const { container, rerender } = render(
            <DawSearchInput value="" onChange={vi.fn()} size="sm" aria-label="Search" />
        );

        const wrapper = container.firstChild as HTMLElement;
        const input = screen.getByRole('searchbox', { name: 'Search' });
        const icon = container.querySelector('svg');

        expect(wrapper).toHaveClass('h-7', 'gap-1.5', 'px-2');
        expect(input).toHaveClass('text-compact');
        expect(icon).toHaveClass('size-3.5');

        rerender(<DawSearchInput value="" onChange={vi.fn()} size="micro" aria-label="Search" />);

        expect(wrapper).toHaveClass('h-6', 'gap-1', 'px-1.5');
        expect(input).toHaveClass('text-dense');
        expect(icon).toHaveClass('size-3');
    });

    it('renders with variant="ghost" and variant="default"', () => {
        const { container, rerender } = render(
            <DawSearchInput value="" onChange={vi.fn()} variant="default" aria-label="Search" />
        );

        const wrapper = container.firstChild as HTMLElement;
        expect(wrapper).toHaveClass('rounded', 'border-border/40', 'bg-surface-inset', 'shadow-none');

        rerender(<DawSearchInput value="" onChange={vi.fn()} variant="ghost" aria-label="Search" />);

        expect(wrapper).toHaveClass('bg-transparent', 'border-transparent');
    });

    it('forwards additional HTML attributes (id, data-testid, disabled, etc.) to the input', () => {
        render(
            <DawSearchInput
                value=""
                onChange={vi.fn()}
                id="search-element"
                data-testid="search-input"
                disabled
                aria-label="Search input"
            />
        );

        const input = screen.getByTestId('search-input');
        expect(input).toHaveAttribute('id', 'search-element');
        expect(input).toBeDisabled();
    });

    it('merges containerClassName and className onto the container element', () => {
        const { container } = render(
            <DawSearchInput
                value=""
                onChange={vi.fn()}
                containerClassName="custom-container"
                className="extra-class"
                inputClassName="custom-input"
                aria-label="Search"
            />
        );

        const wrapper = container.firstChild as HTMLElement;
        expect(wrapper).toHaveClass('custom-container', 'extra-class');

        const input = screen.getByRole('searchbox', { name: 'Search' });
        expect(input).toHaveClass('custom-input');
    });
});
