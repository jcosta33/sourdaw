import { createHandler } from '#/helpers/createHandler';
import { toggleChatPanel } from '../../useCases/togglePanel/panelToggles/toggleChatPanel';

export const handleToggleChatPanel = createHandler<'toggleChatPanel'>({
    execute: () => {
        toggleChatPanel();
    },
    describe: () => ({ label: 'Toggle chat panel' }),
    undoable: false,
});
