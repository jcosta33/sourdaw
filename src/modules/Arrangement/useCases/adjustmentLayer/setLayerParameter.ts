import { adjustmentLayerStore } from '../../stores/adjustmentLayer';

export function setLayerParameter(layerIdVal: string, paramName: string, value: number): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }
    adjustmentLayerStore.set({
        layers: state.layers.map((l) =>
            l.id === layerIdVal
                ? {
                      ...l,
                      parameters: l.parameters.map((p) =>
                          p.name === paramName ? { ...p, value: Math.max(p.min, Math.min(p.max, value)) } : p
                      ),
                  }
                : l
        ),
    });
}
