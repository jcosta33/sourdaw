import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { shortcutStore } from '#/modules/CommandInterface/stores';

import { ShortcutHelp } from '../ShortcutHelp';

function viewRows(): { description: string; keys: string }[] {
    const stack = screen.getByText('View / Zoom').nextElementSibling;
    return Array.from(stack?.children ?? []).map((row) => ({
        description: row.children[0]?.textContent ?? '',
        keys: Array.from(row.children[1]?.children ?? [])
            .map((keycap) => keycap.textContent)
            .join(' '),
    }));
}

function setCustomMappings(customMappings: Record<string, string[]>): void {
    act(() => {
        shortcutStore.set({ definitions: shortcutStore.value?.definitions ?? [], customMappings });
    });
}

function allRows(): { description: string; keys: string }[] {
    const titles = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent ?? '');
    return titles.flatMap((title) => {
        const stack = screen.getByText(title).nextElementSibling;
        return Array.from(stack?.children ?? []).map((row) => ({
            description: row.children[0]?.textContent ?? '',
            keys: Array.from(row.children[1]?.children ?? [])
                .map((keycap) => keycap.textContent)
                .join(' '),
        }));
    });
}

describe('ShortcutHelp', () => {
    beforeEach(() => {
        setCustomMappings({});
    });

    afterEach(() => {
        cleanup();
        setCustomMappings({});
    });

    it('shows A as the store-defined automation visibility shortcut', () => {
        render(<ShortcutHelp />);
        fireEvent.keyDown(window, { key: '?' });

        expect(viewRows()).toContainEqual({ description: 'Cycle Automation Visibility', keys: 'A' });
        expect(viewRows()).toContainEqual({ description: 'Show Automation Panel', keys: '⌘ ⇧ A' });
        expect(screen.getAllByText('Automation tool')).toHaveLength(1);
    });

    it('lists the Cmd+Shift+A combo only on the Show Automation Panel row', () => {
        render(<ShortcutHelp />);
        fireEvent.keyDown(window, { key: '?' });

        const owners = allRows().filter((row) => row.keys === '⌘ ⇧ A');

        expect(owners).toStrictEqual([{ description: 'Show Automation Panel', keys: '⌘ ⇧ A' }]);
    });

    it('follows a user remap of the shortcut', () => {
        setCustomMappings({ 'view.cycleAutomationVisibility': ['alt+u'] });
        render(<ShortcutHelp />);
        fireEvent.keyDown(window, { key: '?' });

        expect(viewRows()).toContainEqual({ description: 'Cycle Automation Visibility', keys: '⌥ U' });
        expect(viewRows()).not.toContainEqual({ description: 'Cycle Automation Visibility', keys: 'A' });
    });

    it('reports open state to the shell', () => {
        const states: boolean[] = [];
        render(<ShortcutHelp onOpenChange={(open) => states.push(open)} />);
        act(() => {
            fireEvent.keyDown(window, { key: '?' });
        });

        expect(states).toStrictEqual([true]);
    });
});
