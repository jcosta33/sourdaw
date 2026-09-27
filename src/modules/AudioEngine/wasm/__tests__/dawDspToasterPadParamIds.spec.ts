import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TOASTER_PAD_PARAM_IDS } from '../../models/ToasterPadParamIds';
import { initSync, ToasterInstance } from '../daw_dsp.js';

// Pins the TS id table against the shipped binary (#4633): the worklet's
// scheduled-hit path dispatches on these ids, and no compiler checks that the
// numbers mean the same parameter on both sides of the wasm boundary. Each id
// must produce byte-identical output to the string write it replaces, the
// same contract `numeric_pad_setter_matches_the_string_path` pins in the
// crate.

const FRAMES = 128;
const LOCK_VALUE = 0.5;
const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'));
const wasm = initSync({ module: new WebAssembly.Module(wasmBytes) });

/** PAD_PARAM_MAP's transform, restated mechanically: camelCase → snake_case. */
function toSnakeCase(name: string): string {
    return name.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function renderLockedHit(padParam: { name: string } | { id: number }): number[] {
    const toaster = new ToasterInstance(48_000, 16);
    try {
        if ('id' in padParam) {
            toaster.set_pad_param_by_id(0, padParam.id, LOCK_VALUE);
        } else {
            toaster.set_pad_param(0, toSnakeCase(padParam.name), LOCK_VALUE);
        }
        toaster.note_on(0, 127, 60);
        const base = toaster.process(FRAMES);
        return Array.from(new Float32Array(wasm.memory.buffer, base, FRAMES));
    } finally {
        toaster.free();
    }
}

describe('checked-in Toaster WASM pad parameter ids', () => {
    it('every TOASTER_PAD_PARAM_IDS id is the same write as its string name', () => {
        for (const [name, id] of Object.entries(TOASTER_PAD_PARAM_IDS)) {
            expect(renderLockedHit({ id }), `${name} (id ${id})`).toEqual(renderLockedHit({ name }));
        }
    });

    // The scheduled-hit path now stages locks through the per-hit overlay
    // (#4636): a hit rendered from staged locks must be byte-identical to the
    // persistent write it replaced — only the persistence changed.
    it('every id renders the same through the per-hit lock overlay as through the persistent write', () => {
        for (const [name, id] of Object.entries(TOASTER_PAD_PARAM_IDS)) {
            const toaster = new ToasterInstance(48_000, 16);
            try {
                toaster.set_pad_param_lock_by_id(0, id, LOCK_VALUE);
                toaster.note_on(0, 127, 60);
                const base = toaster.process(FRAMES);
                expect(Array.from(new Float32Array(wasm.memory.buffer, base, FRAMES)), `${name} (id ${id})`).toEqual(
                    renderLockedHit({ id })
                );
            } finally {
                toaster.free();
            }
        }
    });
});
