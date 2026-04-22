import { describe, it, expect } from 'vitest';

import {
    LOOP_STATION_PAD_ROWS,
    getLoopStationPadCallbackId,
    parseLoopStationPadCallbackId,
    shortcutStore,
} from '../shortcutStore';

describe('Loop Station pad shortcut definitions', () => {
    it('exposes the Ableton-style 4x8 QWERTY layout', () => {
        expect(LOOP_STATION_PAD_ROWS).toHaveLength(4);
        expect(LOOP_STATION_PAD_ROWS.map((row) => row.length)).toEqual([8, 8, 8, 8]);
        expect(LOOP_STATION_PAD_ROWS[0]).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
        expect(LOOP_STATION_PAD_ROWS[1]).toEqual(['q', 'w', 'e', 'r', 't', 'y', 'u', 'i']);
        expect(LOOP_STATION_PAD_ROWS[2]).toEqual(['a', 's', 'd', 'f', 'g', 'h', 'j', 'k']);
        expect(LOOP_STATION_PAD_ROWS[3]).toEqual(['z', 'x', 'c', 'v', 'b', 'n', 'm', ',']);
    });

    it('round-trips callback ids through parse / build', () => {
        const id = getLoopStationPadCallbackId(2, 5, true);
        const parsed = parseLoopStationPadCallbackId(id);
        expect(parsed).toEqual({ rowIndex: 2, columnIndex: 5, record: true });
    });

    it('returns null for ids that are not loop station pad callbacks', () => {
        expect(parseLoopStationPadCallbackId('stopPlayback')).toBeNull();
        expect(parseLoopStationPadCallbackId('loopStationPad.play.r0cX')).toBeNull();
    });

    it('registers 64 pad definitions (4 rows x 8 cols x 2 variants) in the shortcut store', () => {
        const padDefinitions =
            shortcutStore.value?.definitions.filter((def) => def.id.startsWith('loopStation.pad.')) ?? [];
        expect(padDefinitions).toHaveLength(64);

        const playDefs = padDefinitions.filter((def) => def.id.endsWith('.play'));
        const recordDefs = padDefinitions.filter((def) => def.id.endsWith('.record'));
        expect(playDefs).toHaveLength(32);
        expect(recordDefs).toHaveLength(32);
    });

    it('record-variant defaults carry a shift modifier', () => {
        const defs = shortcutStore.value?.definitions ?? [];
        const recordDef = defs.find((def) => def.id === 'loopStation.pad.r1c0.record');
        expect(recordDef?.defaultKeys).toEqual(['shift+q']);

        const playDef = defs.find((def) => def.id === 'loopStation.pad.r1c0.play');
        expect(playDef?.defaultKeys).toEqual(['q']);
    });
});
