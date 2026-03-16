import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import type { AppAction, AppActionType } from "../models/AppAction";
import { collaborationStore } from "#/modules/Collaboration/stores/collaborationStore";
import { broadcastAction } from "#/modules/Collaboration/useCases/collaborationUseCases";

const logger = Container.getInstance().get(Logger);
import type { ActionHandler } from "../models/ActionHandler";
import { createUndoEntry } from "../models/UndoEntry";
import { pushUndo } from "../stores/undoStore";
import { trackHandlers } from "../handlers/trackHandlers";
import { clipHandlers } from "../handlers/clipHandlers";
import { transportHandlers } from "../handlers/transportHandlers";
import { deviceHandlers } from "../handlers/deviceHandlers";
import { workspaceHandlers } from "../handlers/workspaceHandlers";
import { automationHandlers } from "../handlers/automationHandlers";
import { presetHandlers } from "../handlers/presetHandlers";
import { generationHandlers } from "../handlers/generationHandlers";
import { stretchHandlers } from "../handlers/stretchHandlers";
import { analysisHandlers } from "../handlers/analysisHandlers";
import { collaborationHandlers } from "../handlers/collaborationHandlers";
import { pluginHostHandlers } from "../handlers/pluginHostHandlers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- handlers are type-safe at definition site; the registry erases the action subtype for dynamic dispatch
const handlerRegistry: Record<string, ActionHandler<any>> = {
    ...trackHandlers,
    ...clipHandlers,
    ...transportHandlers,
    ...deviceHandlers,
    ...workspaceHandlers,
    ...automationHandlers,
    ...presetHandlers,
    ...generationHandlers,
    ...stretchHandlers,
    ...analysisHandlers,
    ...collaborationHandlers,
    ...pluginHostHandlers,
};

export type ExecuteOptions = {
    groupId?: string;
    groupLabel?: string;
    source?: "manual" | "prompt" | "voice" | "ai";
};

export const executeAppAction = async (action: AppAction, options?: ExecuteOptions): Promise<void> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = handlerRegistry[action.type] as ActionHandler<any> | undefined;
    if (!handler) {
        logger.warn(`No handler registered for action: ${action.type}`);
        return;
    }

    await handler.execute(action);

    if (collaborationStore.value?.sessionId) {
        broadcastAction(action);
    }

    if (handler.undoable) {
        const result = handler.describe(action);
        const entry = createUndoEntry(result.label, action, result.inverseAction ?? null, options?.source ?? "manual");
        if (options?.groupId) {
            entry.groupId = options.groupId;
            entry.groupLabel = options.groupLabel;
        }
        pushUndo(entry);
    }
};

export const isRegisteredAction = (type: string): type is AppActionType => type in handlerRegistry;
