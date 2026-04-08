import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ImportMidiPayload } from '#/modules/Workspace/events/WorkspaceEvents';

export const onProjectSave = inject({ eventBus })(
    ({ eventBus }) =>
        function onProjectSave(handler: () => void): () => void {
            return eventBus.on('project.save', handler);
        }
);

export const onProjectNew = inject({ eventBus })(
    ({ eventBus }) =>
        function onProjectNew(handler: () => void): () => void {
            return eventBus.on('project.new', handler);
        }
);

export const onCommandUndo = inject({ eventBus })(
    ({ eventBus }) =>
        function onCommandUndo(handler: () => void): () => void {
            return eventBus.on('command.undo', handler);
        }
);

export const onCommandRedo = inject({ eventBus })(
    ({ eventBus }) =>
        function onCommandRedo(handler: () => void): () => void {
            return eventBus.on('command.redo', handler);
        }
);

export const onMidiImport = inject({ eventBus })(
    ({ eventBus }) =>
        function onMidiImport(handler: (payload: ImportMidiPayload) => void): () => void {
            return eventBus.on('midi.import', handler);
        }
);
