import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GrooveTemplateLifecycleControls } from '../GrooveTemplateLifecycleControls';

const mocks = vi.hoisted(() => ({
    rename: vi.fn<(templateId: string, name: string) => Promise<void>>(),
}));

vi.mock('../../../useCases/renameYeastGrooveTemplate', () => ({
    renameYeastGrooveTemplate: mocks.rename,
}));

describe('GrooveTemplateLifecycleControls', () => {
    beforeEach(() => {
        mocks.rename.mockReset();
        mocks.rename.mockResolvedValue(undefined);
    });

    it('reconciles a canonical rename without remounting the focused input', () => {
        const view = render(<GrooveTemplateLifecycleControls templateId="template-1" templateName="Original" />);
        const nameInput = screen.getByRole('textbox', { name: 'Groove template name' });
        nameInput.focus();
        fireEvent.change(nameInput, { target: { value: 'Unsaved local edit' } });

        view.rerender(<GrooveTemplateLifecycleControls templateId="template-1" templateName="Restored name" />);

        expect(screen.getByRole('textbox', { name: 'Groove template name' })).toBe(nameInput);
        expect(nameInput).toHaveFocus();
        expect(nameInput).toHaveValue('Restored name');
    });

    it('preserves a newer draft while an async rename reconciles the submitted canonical name', async () => {
        let resolveRename: (() => void) | undefined;
        mocks.rename.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                resolveRename = resolve;
            })
        );
        const view = render(<GrooveTemplateLifecycleControls templateId="template-1" templateName="Original" />);
        const nameInput = screen.getByRole('textbox', { name: 'Groove template name' });
        nameInput.focus();
        fireEvent.change(nameInput, { target: { value: 'Submitted name' } });
        fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

        expect(mocks.rename).toHaveBeenCalledWith('template-1', 'Submitted name');
        expect(screen.getByRole('button', { name: 'Renaming…' })).toBeDisabled();
        fireEvent.change(nameInput, { target: { value: 'Next draft' } });
        view.rerender(<GrooveTemplateLifecycleControls templateId="template-1" templateName="Submitted name" />);

        expect(screen.getByRole('textbox', { name: 'Groove template name' })).toBe(nameInput);
        expect(nameInput).toHaveFocus();
        expect(nameInput).toHaveValue('Next draft');

        await act(async () => {
            resolveRename?.();
            await Promise.resolve();
        });

        await waitFor(() => expect(screen.getByRole('button', { name: 'Rename' })).toBeEnabled());
        expect(nameInput).toHaveValue('Next draft');
    });

    it('reconciles a collision-resolved canonical name when no newer draft was typed', async () => {
        let resolveRename: (() => void) | undefined;
        mocks.rename.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                resolveRename = resolve;
            })
        );
        const view = render(<GrooveTemplateLifecycleControls templateId="template-1" templateName="Original" />);
        const nameInput = screen.getByRole('textbox', { name: 'Groove template name' });
        nameInput.focus();
        fireEvent.change(nameInput, { target: { value: 'Name' } });
        fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

        view.rerender(<GrooveTemplateLifecycleControls templateId="template-1" templateName="Name 2" />);
        await act(async () => {
            resolveRename?.();
            await Promise.resolve();
        });

        await waitFor(() => expect(screen.getByRole('button', { name: 'Rename' })).toBeEnabled());
        expect(screen.getByRole('textbox', { name: 'Groove template name' })).toBe(nameInput);
        expect(nameInput).toHaveFocus();
        expect(nameInput).toHaveValue('Name 2');

        fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
        await waitFor(() => expect(mocks.rename).toHaveBeenCalledTimes(2));
        expect(mocks.rename).toHaveBeenLastCalledWith('template-1', 'Name 2');
    });
});
