import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The Gluten manual used to say the twelve Detector controls — including Ext SC
 * — shape a signal only Diode reads, and that VCA, Opto, and FET listen to an
 * unfiltered input. The engine and panel already route the filtered detector
 * (and a real external key) through every topology, including the default VCA.
 *
 * This file reads the shipped page and asserts the *routing claim*, not
 * decorative copy: the false Diode-only / unfiltered-input story must be gone,
 * and the page must state that external sidechain reaches the detector on the
 * selected topology, including VCA.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../../');
const MANUAL_SOURCE = 'docs/manual/devices/07-gluten.md';

function readManual(): string {
    return readFileSync(join(REPO_ROOT, MANUAL_SOURCE), 'utf8');
}

describe('the Gluten manual states detector routing that matches the engine', () => {
    it('no longer claims detector controls are inactive off Diode', () => {
        const manual = readManual();

        expect(manual).not.toMatch(/Not yet active off Diode/i);
        expect(manual).not.toMatch(/shape a detector\s+signal only the \*\*Diode\*\* topology reads/i);
        expect(manual).not.toMatch(/ducking one\s+track under another means selecting Diode/i);
        expect(manual).not.toMatch(/switch to the Diode topology,\s+route the kick/i);
    });

    it('no longer claims VCA, Opto, and FET listen to an unfiltered input', () => {
        const manual = readManual();

        expect(manual).not.toMatch(/On VCA, Opto, and FET the detector listens to the\s+unfiltered input/i);
        expect(manual).not.toMatch(/unfiltered input/i);
    });

    it('states that external sidechain reaches the detector on the selected topology, including VCA', () => {
        const manual = readManual();
        // Blockquote lines keep a leading `>`; collapse those before matching prose.
        const normalised = manual.replaceAll(/^>\s?/gm, '').replaceAll(/\s+/g, ' ');

        expect(normalised).toMatch(
            /External sidechain reaches that topology's detector|external sidechain reaches the detector/i
        );
        expect(normalised).toMatch(/including the default VCA|including VCA/i);
        expect(normalised).toMatch(/on whatever topology is selected/i);
    });
});
