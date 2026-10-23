import { buildLevainZoneTablesInWorker } from '../repositories/levainZoneTables/buildLevainZoneTablesInWorker';

import type { LevainZoneTableRequest, LevainZoneTables } from '../models/LevainZoneTables';

/**
 * Compute a Levain bank's zone tables off the render thread, for the loader to
 * stage into the worklet in bounded chunks. Rejects when the build fails and at
 * once on `signal`.
 */
export function buildLevainZoneTables(
    request: LevainZoneTableRequest,
    signal?: AbortSignal
): Promise<LevainZoneTables> {
    return buildLevainZoneTablesInWorker(request, signal);
}
