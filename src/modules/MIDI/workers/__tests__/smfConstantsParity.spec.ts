import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import {
    SMF_CONTROL_CHANGE_STATUS,
    SMF_META_EVENT,
    SMF_META_END_OF_TRACK,
    SMF_META_SET_TEMPO,
    SMF_META_TRACK_NAME,
    SMF_NOTE_OFF_STATUS,
    SMF_NOTE_ON_STATUS,
} from '../../models/SmfConstants';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../');
const WORKER_SOURCE = readFileSync(join(REPO_ROOT, 'src/modules/MIDI/workers/midiImportWorker.ts'), 'utf8');

const hex = (byte: number): string => `0x${byte.toString(16).padStart(2, '0')}`;

/**
 * The importer decodes the same status bytes the exporter writes
 * (`useCases/exportMidiFile.ts`), but it runs in a separately bundled worker
 * realm and restates them as literals rather than importing
 * `models/SmfConstants.ts`. This spec is the pin: if either side of a pair
 * drifts, the importer silently misparses every file the exporter produces.
 * The worker is read as source text because importing it outside the worker
 * realm is not possible — the same pattern workletPortMessageParity.spec uses.
 */
describe('SMF wire-byte parity between SmfConstants and the import worker', () => {
    it("owns the exporter's byte values", () => {
        expect(SMF_NOTE_ON_STATUS).toBe(0x90);
        expect(SMF_NOTE_OFF_STATUS).toBe(0x80);
        expect(SMF_CONTROL_CHANGE_STATUS).toBe(0xb0);
        expect(SMF_META_EVENT).toBe(0xff);
        expect(SMF_META_TRACK_NAME).toBe(0x03);
        expect(SMF_META_END_OF_TRACK).toBe(0x2f);
        expect(SMF_META_SET_TEMPO).toBe(0x51);
    });

    it('decodes every status byte with the exact spelling SmfConstants owns', () => {
        expect(WORKER_SOURCE).toContain(`statusByte === ${hex(SMF_META_EVENT)}`);
        expect(WORKER_SOURCE).toContain(`metaType === ${hex(SMF_META_TRACK_NAME)}`);
        expect(WORKER_SOURCE).toContain(`metaType === ${hex(SMF_META_SET_TEMPO)}`);
        expect(WORKER_SOURCE).toContain(`eventType === ${hex(SMF_NOTE_ON_STATUS)}`);
        expect(WORKER_SOURCE).toContain(`eventType === ${hex(SMF_NOTE_OFF_STATUS)}`);
        expect(WORKER_SOURCE).toContain(`eventType === ${hex(SMF_CONTROL_CHANGE_STATUS)}`);
    });
});
