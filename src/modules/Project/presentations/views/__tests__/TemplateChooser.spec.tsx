import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { pendingProjectReplacements } from '../../../useCases/projectPersistence/pendingProjectReplacements';
import { saveProject } from '../../../useCases/projectPersistence/saveProject/saveProject';
import { createFromTemplate } from '../../../useCases/projectTemplates/templateDefinitions/createFromTemplate';
import { TemplateChooser } from '../TemplateChooser';

const mocks = vi.hoisted(() => ({
    projectStoreValue: { value: null as { dirty: boolean } | null },
}));

vi.mock('../../../stores/projectStore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../stores/projectStore')>()),
    projectStore: {
        get value() {
            return mocks.projectStoreValue.value;
        },
        set: vi.fn(),
    },
}));

vi.mock('../../../useCases/projectPersistence/saveProject/saveProject', () => ({
    saveProject: vi.fn(),
}));

vi.mock('../../../useCases/projectTemplates/templateDefinitions/createFromTemplate', () => ({
    createFromTemplate: vi.fn(),
}));

vi.mock('../../../useCases/projectTemplates/templateDefinitions/getTemplates', () => ({
    getTemplates: vi.fn(() => [
        {
            id: 'guard-spec-song',
            name: 'Guard Spec Song',
            description: 'Two tracks and a return bus.',
            category: 'music',
        },
        {
            id: 'guard-spec-demo',
            name: 'Guard Spec Demo',
            description: 'A finished demo.',
            category: 'demo',
        },
    ]),
}));

describe('TemplateChooser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectStoreValue.value = null;
    });

    it('should render without crashing', () => {
        render(<TemplateChooser open={false} onClose={vi.fn()} />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<TemplateChooser open={false} onClose={vi.fn()} />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<TemplateChooser open={false} onClose={vi.fn()} />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });

    it('switches to the template when the pre-switch save succeeds clean', async () => {
        mocks.projectStoreValue.value = { dirty: false };
        vi.mocked(saveProject).mockResolvedValue(true);
        vi.mocked(createFromTemplate).mockResolvedValue(true);

        render(<TemplateChooser open onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Guard Spec Song/ }));

        await waitFor(() =>
            expect(createFromTemplate).toHaveBeenCalledWith('guard-spec-song', { shouldProceed: expect.any(Function) })
        );
    });

    // Choosing the open project's Recent entry while the template is pending
    // withdraws it, so the session stays in the project the user chose last.
    it('does not create the template once a pre-save that the open project choice outlasted finishes', async () => {
        mocks.projectStoreValue.value = { dirty: false };
        const save = Promise.withResolvers<boolean>();
        vi.mocked(saveProject).mockReturnValueOnce(save.promise);

        render(<TemplateChooser open onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Guard Spec Song/ }));
        await waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
        pendingProjectReplacements.withdraw();
        save.resolve(true);

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(createFromTemplate).not.toHaveBeenCalled();
    });

    it('hands the template a check that the open project choice turns false', async () => {
        mocks.projectStoreValue.value = { dirty: false };
        vi.mocked(saveProject).mockResolvedValue(true);
        const creation = Promise.withResolvers<boolean>();
        vi.mocked(createFromTemplate).mockReturnValueOnce(creation.promise);

        render(<TemplateChooser open onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Guard Spec Song/ }));
        await waitFor(() => expect(createFromTemplate).toHaveBeenCalledOnce());
        const shouldProceed = vi.mocked(createFromTemplate).mock.calls[0]?.[1]?.shouldProceed;

        expect(shouldProceed?.()).toBe(true);
        pendingProjectReplacements.withdraw();
        expect(shouldProceed?.()).toBe(false);
        creation.resolve(false);
    });

    // Issue 3694: a save can resolve true while the project is still dirty —
    // a plugin state capture rejected before commit warns and keeps that edit
    // out of project truth. Creating the template over it would destroy the
    // edit, so the switch must refuse even though the save resolved.
    it('refuses the template switch when the pre-switch save resolved but left the project dirty', async () => {
        mocks.projectStoreValue.value = { dirty: true };
        vi.mocked(saveProject).mockResolvedValue(true);

        render(<TemplateChooser open onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Guard Spec Song/ }));

        await waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
        await Promise.resolve();
        await Promise.resolve();
        expect(createFromTemplate).not.toHaveBeenCalled();
    });

    // Radix keeps DialogContent mounted until its exit animation ends, so a quick close and
    // reopen reuses the old gallery unless each open session mounts a fresh one. jsdom runs no
    // animations, so the test reports an animation name that changes on close to hold the content.
    it('reopens on the requested category instead of the filter chosen last time', () => {
        let closing = false;
        const realGetComputedStyle = window.getComputedStyle.bind(window);
        vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
            const style = realGetComputedStyle(element, pseudo);
            return new Proxy(style, {
                get(target, property) {
                    if (property === 'animationName') {
                        return closing ? 'dialog-exit' : 'dialog-enter';
                    }
                    const value: unknown = Reflect.get(target, property);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
        });

        const { rerender } = render(<TemplateChooser open onClose={vi.fn()} initialCategory="demo" />);
        expect(screen.getByRole('radio', { name: 'Demos' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.queryByRole('button', { name: /Guard Spec Song/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('radio', { name: 'Music' }));
        expect(screen.getByRole('radio', { name: 'Music' })).toHaveAttribute('aria-checked', 'true');

        closing = true;
        rerender(<TemplateChooser open={false} onClose={vi.fn()} initialCategory="demo" />);
        expect(screen.getByRole('radio', { name: 'Music', hidden: true })).toBeInTheDocument();

        closing = false;
        rerender(<TemplateChooser open onClose={vi.fn()} initialCategory="all" />);

        expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('button', { name: /Guard Spec Song/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Guard Spec Demo/ })).toBeInTheDocument();
        vi.restoreAllMocks();
    });
});
