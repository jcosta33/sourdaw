import { type OfflineRenderSessionSource } from './OfflineRenderSource';

/** A modulator without its name; the render reads its config, mappings and enabled state. */
export function readPrintedModulator(modulator: OfflineRenderSessionSource['modulators'][number]) {
    const { name: _name, ...read } = modulator;
    return read;
}
