import { handleToggleNodeView } from '../handlers/nodeView/handleToggleNodeView';

export type NodeViewHandlersMap = {
    toggleNodeView: typeof handleToggleNodeView;
};

/**
 * Merges Routing node-view `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getNodeViewHandlers(): NodeViewHandlersMap {
    return {
        toggleNodeView: handleToggleNodeView,
    };
}
