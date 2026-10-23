import { LEVAIN_ZONE_TABLE_CHUNK_ENTRIES } from '#/infra/audioWorklet/levainZoneTableChunk';

import { computeLevainZoneTables } from '../../transformers/computeLevainZoneTables';

import type { LevainZoneSpan, LevainZoneTableRequest, LevainZoneTables } from '../../models/LevainZoneTables';

// Shipped-engine specs stage a bank's zone tables the way the loader does: the
// tables computed in-process by the engine's own builder (the Worker's code,
// without the Worker), then reserve, chunks of at most one chunk, seal.

export type Deliver = (data: Record<string, unknown> & { type: string }) => void;

/** Zones that each cover one note (`zoneId % 128`) at every velocity, on articulation 0 and mic 0. */
export function oneNoteZones(count: number): LevainZoneSpan[] {
    return Array.from({ length: count }, (_, zoneId) => ({
        zoneId,
        articulationId: 0,
        micId: 0,
        loKey: zoneId % 128,
        hiKey: zoneId % 128,
        loVel: 0,
        hiVel: 127,
    }));
}

/** One zone covering every note and velocity on articulation 0 and mic 0. */
export const WIDE_ZONE: LevainZoneSpan = {
    zoneId: 0,
    articulationId: 0,
    micId: 0,
    loKey: 0,
    hiKey: 127,
    loVel: 0,
    hiVel: 127,
};

/** Deliver `tables` as the loader posts them, without the commit. */
export function deliverZoneTables(
    deliver: Deliver,
    loadToken: number,
    dimensions: { numArticulations: number; numMics: number },
    tables: LevainZoneTables
): void {
    deliver({
        type: 'reserveZoneTables',
        loadToken,
        numArticulations: dimensions.numArticulations,
        numMics: dimensions.numMics,
        lutEntries: tables.lut.length / 2,
        arenaEntries: tables.arena.length,
    });
    for (const [table, words, wordsPerEntry] of [
        ['lut', tables.lut, 2],
        ['arena', tables.arena, 1],
    ] as const) {
        const chunkWords = LEVAIN_ZONE_TABLE_CHUNK_ENTRIES * wordsPerEntry;
        for (let offset = 0; offset < words.length; offset += chunkWords) {
            deliver({
                type: 'zoneTableChunk',
                loadToken,
                table,
                start: offset / wordsPerEntry,
                data: words.slice(offset, offset + chunkWords),
            });
        }
    }
    deliver({ type: 'sealZoneTables', loadToken });
}

/** Compute `request`'s tables with the shipped builder, stage them and send the commit trigger. */
export function stageAndCommitBank(
    deliver: Deliver,
    wasmModule: WebAssembly.Module,
    loadToken: number,
    request: LevainZoneTableRequest
): void {
    deliverZoneTables(deliver, loadToken, request, computeLevainZoneTables(wasmModule, request));
    deliver({ type: 'commitSampleBank', loadToken });
}
