import { initSync, LevainZoneTableBuilder } from '../wasm/daw_dsp.js';

import type { LevainZoneTableRequest, LevainZoneTables } from '../models/LevainZoneTables';

/**
 * Compute a Levain bank's zone tables with the engine's own table algorithm
 * (`LevainZoneTableBuilder`, the code `build_zone_map` runs), on whatever
 * thread calls this. Instantiates `wasmModule` in this realm if it is not
 * already. Throws for dimensions or capacities the engine refuses.
 */
export function computeLevainZoneTables(
    wasmModule: WebAssembly.Module,
    request: LevainZoneTableRequest
): LevainZoneTables {
    initSync({ module: wasmModule });
    const builder = new LevainZoneTableBuilder();
    try {
        for (const zone of request.zones) {
            builder.add_zone(zone.zoneId, zone.articulationId, zone.micId, zone.loKey, zone.hiKey, zone.loVel, zone.hiVel);
        }
        if (!builder.build(request.numArticulations, request.numMics)) {
            throw new Error('Levain zone tables exceed the DSP dimension or capacity limits');
        }
        return { lut: builder.lut(), arena: builder.arena() };
    } finally {
        builder.free();
    }
}
