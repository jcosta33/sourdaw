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
