import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderGeneratedRegion } from '../../crates/daw-dsp/benches/wasm/renderTable.mjs';

const measurement = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../crates/daw-dsp/benches/quantum-cost-table.json'), 'utf8')
) as { rows: { id: string; medianTrustworthy: boolean }[] };

function withTrust(trust: boolean) {
    const data = structuredClone(measurement);
    for (const row of data.rows) row.medianTrustworthy = trust;
    return data;
}

function rowById(data: typeof measurement, id: string) {
    const row = data.rows.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`missing measurement row ${id}`);
    return row;
}

describe('quantum cost report calibration', () => {
    it('retains measured floors and timings but withholds claims depending on unreliable audio and worker medians', () => {
        const rendered = renderGeneratedRegion(measurement);
        expect(rendered).toContain(
            'Crumbs (32 sounding voices, in-memory pool) | 490 µs | **550 µs** (unreliable median)'
        );
        expect(rendered).toContain(
            'Grand Boule (64 voices, re-struck 1/s) — production Worker cost site | 1600 µs | **2200 µs** (unreliable median)'
        );
        expect(rendered).toContain('(unreliable median)');
        expect(rendered).toContain(
            '| **Audio thread, median-based total** | **1.1** | **43%** | unreliable, not an upper bound |'
        );
        expect(rendered).toContain('**NOT DECIDED by compute alone.**');
        expect(rendered).toContain('1 × crumbs');
        expect(rendered).toContain('median is unreliable, not an upper bound');
        expect(rendered).not.toContain('DECIDED: the upper bound already fits.');
        expect(rendered).toContain('| Audio thread, lower bound | 0.72 | 27% |');
    });

    it('only withholds reference conclusions when their own members are unreliable', () => {
        const data = withTrust(true);
        const trusted = renderGeneratedRegion(data);
        expect(trusted).toContain('**DECIDED: the upper bound already fits.**');
        expect(trusted).toContain('**the decisive figure**');
        rowById(data, 'grand_boule').medianTrustworthy = false;
        const workerOnly = renderGeneratedRegion(data);
        expect(workerOnly).toContain('**DECIDED: the upper bound already fits.**');
        expect(workerOnly).toContain('median is unreliable, not an upper bound');
        rowById(data, 'grand_boule').medianTrustworthy = true;
        rowById(data, 'crumbs').medianTrustworthy = false;
        const audioOnly = renderGeneratedRegion(data);
        expect(audioOnly).toContain('**NOT DECIDED by compute alone.**');
        expect(audioOnly).not.toContain('median is unreliable, not an upper bound');
    });
});
