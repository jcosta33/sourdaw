import { type OfflineRenderSessionSource } from './OfflineRenderSource';

/** An adjustment layer without its name and colour, which only the layer's own row shows. */
export function readPrintedAdjustmentLayer(layer: OfflineRenderSessionSource['adjustmentLayers'][number]) {
    const { name: _name, color: _color, ...read } = layer;
    return read;
}
