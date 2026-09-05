import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renameClip } from '#/modules/Arrangement/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { promptUser } from '#/utils/Notification/promptUser';

import { type CallableCommandEntry } from '../../searchCommandRegistry';
import { clipCommands } from '../ClipCommands';
import { trackCommands } from '../TrackCommands';

vi.mock('#/utils/Notification/promptUser', () => ({ promptUser: vi.fn() }));
vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    duplicateTrack: vi.fn(),
    removeTrack: vi.fn(),
    renameClip: vi.fn(),
    splitClip: vi.fn(),
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        value: {
            tracks: [{ id: 't1', name: 'Old Track', clips: [{ id: 'c1', name: 'Old Clip' }] }],
        },
    },
}));
vi.mock('../../selectionHelpers/getSelectedTrackId', () => ({ getSelectedTrackId: () => 't1' }));
vi.mock('../../selectionHelpers/getSelectedClipId', () => ({ getSelectedClipId: () => 'c1' }));

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function runAction(command: CallableCommandEntry | undefined): void {
    if (!command || typeof command.action !== 'function') {
        throw new Error('Expected a callable command action');
    }
    command.action();
}

describe('rename commands use the themed promptUser dialog (not window.prompt)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(executeUserAppAction).mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('rename-track prompts with the current name and dispatches renameTrack with the entered value', async () => {
        vi.mocked(promptUser).mockResolvedValue('New Track');

        runAction(trackCommands.find((command) => command.id === 'rename-track'));
        await flush();

        expect(promptUser).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Rename Track', initialValue: 'Old Track' })
        );
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'renameTrack',
            payload: { trackId: 't1', name: 'New Track' },
        });
    });

    it('rename-track dispatches nothing when the prompt is cancelled', async () => {
        vi.mocked(promptUser).mockResolvedValue(null);

        runAction(trackCommands.find((command) => command.id === 'rename-track'));
        await flush();

        expect(executeUserAppAction).not.toHaveBeenCalled();
    });

    it('rename-clip prompts with the current name and renames the clip with the entered value', async () => {
        vi.mocked(promptUser).mockResolvedValue('New Clip');

        runAction(clipCommands.find((command) => command.id === 'rename-clip'));
        await flush();

        expect(promptUser).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Rename Clip', initialValue: 'Old Clip' })
        );
        expect(renameClip).toHaveBeenCalledWith('c1', 'New Clip');
    });

    it('rename-clip renames nothing when the prompt is cancelled', async () => {
        vi.mocked(promptUser).mockResolvedValue(null);

        runAction(clipCommands.find((command) => command.id === 'rename-clip'));
        await flush();

        expect(renameClip).not.toHaveBeenCalled();
    });
});
