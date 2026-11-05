import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type ReactElement } from 'react';

import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { GenreGrid, InstrumentGrid, MoodGrid } from '../GenerativeParamGrids';

type GridComponent = (props: { value: string; onChange: (val: string) => void }) => ReactElement;

const GRIDS: ReadonlyArray<{ testId: string; Grid: GridComponent }> = [
    { testId: 'genre-grid', Grid: GenreGrid },
    { testId: 'mood-grid', Grid: MoodGrid },
    { testId: 'instrument-grid', Grid: InstrumentGrid },
];

// Tailwind generates a utility only from a complete class name written in a source file, so every class
// a selected card adds must appear whole inside one of the component's string literals.
const SOURCE = readFileSync(
    join(process.cwd(), 'src/modules/AiRuntime/presentations/components/GenerativeParamGrids.tsx'),
    'utf8'
);
const SOURCE_CLASS_NAMES = new Set(
    Array.from(SOURCE.matchAll(/'([^'\n]*)'/g), (match) => match[1] ?? '').flatMap((literal) => literal.split(/\s+/))
);

function classNamesWithin(element: Element): Set<string> {
    const elements = [element, ...Array.from(element.querySelectorAll('*'))];
    return new Set(elements.flatMap((node) => Array.from(node.classList)));
}

describe('GenerativeParamGrids', () => {
    it('should render', () => {
        const onChange = vi.fn();
        render(<GenreGrid value="" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /lo-fi/i }));
        expect(onChange).toHaveBeenCalled();
    });

    it.each(GRIDS)('spells every class a selected $testId card adds out in full', ({ testId, Grid }) => {
        const onChange = vi.fn();
        const { rerender } = render(<Grid value="" onChange={onChange} />);
        const card = (label: string): HTMLElement =>
            within(screen.getByTestId(testId)).getByRole('button', { name: label });
        const labels = within(screen.getByTestId(testId))
            .getAllByRole('button')
            .map((button) => button.textContent ?? '');
        expect(labels.length).toBeGreaterThan(0);

        for (const label of labels) {
            rerender(<Grid value="" onChange={onChange} />);
            const unselected = classNamesWithin(card(label));
            onChange.mockClear();
            fireEvent.click(card(label));
            rerender(<Grid value={String(onChange.mock.calls[0]?.[0])} onChange={onChange} />);

            const added = Array.from(classNamesWithin(card(label))).filter((name) => !unselected.has(name));
            expect(added.some((name) => /^border-[a-z]+-500\/50$/.test(name))).toBe(true);
            expect(added.filter((name) => !SOURCE_CLASS_NAMES.has(name))).toEqual([]);
        }
    });
});
