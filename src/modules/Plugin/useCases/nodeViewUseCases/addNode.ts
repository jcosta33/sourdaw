import { nodeViewStore, getNextNodeId, NODE_COLORS, type ProcessingNodeType, type ProcessingNode } from '#/modules/Plugin/stores/nodeView';

export function addNode(type: ProcessingNodeType, label: string, x: number, y: number, deviceId: string | null = null): void {
    const state = nodeViewStore.value;
    if (!state) { return; }

    const node: ProcessingNode = {
        id: getNextNodeId(),
        type, label, deviceId, x, y,
        width: 120, height: 60,
        bypassed: false,
        color: NODE_COLORS[type],
    };

    nodeViewStore.set({ ...state, nodes: [...state.nodes, node] });
}
