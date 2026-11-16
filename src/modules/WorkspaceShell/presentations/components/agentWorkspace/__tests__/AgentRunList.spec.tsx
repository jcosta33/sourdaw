import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentRunList } from '../AgentRunList';

const RUNS = [
    { runId: 'run-a', request: 'Tighten the drums', phase: 'done' },
    { runId: 'run-b', request: 'Brighten the vocal', phase: 'running' },
];

function renderList(selectedRunId: string | null = 'run-a') {
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    render(<AgentRunList runs={RUNS} selectedRunId={selectedRunId} onSelect={onSelect} onActivate={onActivate} />);
    return { onSelect, onActivate, listbox: screen.getByRole('listbox', { name: 'Agent runs' }) };
}

describe('AgentRunList', () => {
    it('activates the run whose option the pointer clicks, including a click on its text', () => {
        const { onActivate } = renderList();

        fireEvent.click(screen.getByText('Brighten the vocal'));

        expect(onActivate).toHaveBeenCalledExactlyOnceWith('run-b');
    });

    it('ignores a click on the listbox outside every option', () => {
        const { onActivate, listbox } = renderList();

        fireEvent.click(listbox);

        expect(onActivate).not.toHaveBeenCalled();
    });

    it.each(['Enter', ' '])('activates the active option on %j, as a click on it does', (key) => {
        const { onActivate, listbox } = renderList('run-b');

        const claimed = !fireEvent.keyDown(listbox, { key });

        expect(onActivate).toHaveBeenCalledExactlyOnceWith('run-b');
        expect(claimed).toBe(true);
    });

    it('moves selection with the arrow keys and points aria-activedescendant at it', () => {
        const { onSelect, listbox } = renderList('run-a');
        expect(listbox).toHaveAttribute('aria-activedescendant', 'agent-run-option-run-a');

        fireEvent.keyDown(listbox, { key: 'ArrowDown' });

        expect(onSelect).toHaveBeenCalledExactlyOnceWith('run-b');
    });
});
