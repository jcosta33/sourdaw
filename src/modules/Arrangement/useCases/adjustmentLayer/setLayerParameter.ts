import { adjustmentLayerStore } from '../../stores/adjustmentLayer';

export function setLayerParameter(layerIdVal: string, paramName: string, value: number): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }
    adjustmentLayerStore.set({
        layers: state.layers.map((length) =>
            length.id === layerIdVal
                ? {
                      ...length,
                      parameters: length.parameters.map((param) =>
                          param.name === paramName ? { ...param, value: Math.max(param.min, Math.min(param.max, value)) } : param
                      ),
                  }
                : length
        ),
    });
}
