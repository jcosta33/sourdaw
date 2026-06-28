import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { newProject } from '#/modules/Project/useCases/projectPersistence/newProject';

import { LaunchScreen } from '../LaunchScreen';

vi.mock('#/modules/Project/useCases/projectPersistence/newProject', () => ({
    newProject: vi.fn(),
}));

vi.mock('#/modules/Project/useCases/projectTemplates/templateDefinitions/getTemplates', () => ({
    getTemplates: vi.fn(() => []),
}));

vi.mock('#/modules/Project/useCases/projectTemplates/templateDefinitions/createFromTemplate', () => ({
    createFromTemplate: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...actual,
        decodeAudioFile: vi.fn(),
    };
});

vi.mock('#/modules/Arrangement', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement')>();
    return {
        ...actual,
        importMidiFile: vi.fn(),
    };
});

vi.mock('#/modules/Transport/stores/transportStore', () => ({
    transportStore: { value: { tempo: 120 } },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

describe('LaunchScreen', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render the launch dialog with primary actions', () => {
        render(<LaunchScreen exiting={false} />);
        expect(screen.getByRole('dialog', { name: /Sourdaw — start a project/ })).toBeInTheDocument();
        expect(screen.getByText('Sourdaw')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /New Project/ })).toBeInTheDocument();
    });

    it('starts a new project in the click handler before shortcuts can run', () => {
        render(<LaunchScreen exiting={false} />);

        fireEvent.click(screen.getByRole('button', { name: /New Project/ }));

        expect(newProject).toHaveBeenCalledTimes(1);
    });
});
