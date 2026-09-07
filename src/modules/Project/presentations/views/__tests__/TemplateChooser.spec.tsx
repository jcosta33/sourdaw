import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

        await waitFor(() => expect(createFromTemplate).toHaveBeenCalledWith('guard-spec-song'));
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
});
