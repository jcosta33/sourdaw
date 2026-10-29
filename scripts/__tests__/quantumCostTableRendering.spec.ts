import { describe, expect, it } from 'vitest';

import { renderConsoleReference, renderGeneratedRegion } from '../../crates/daw-dsp/benches/wasm/renderTable.mjs';

// Fixed synthetic data keeps the regression independent of future measurements.
const row = (id: string, label: string, costSite: string, floor: number, median: number) => ({
    id,
    label,
    costSite,
    warmVerify: { ok: true, detail: 'fixture warm' },
    lateVerify: { ok: true, detail: 'fixture late' },
    stats: { n: 8, mean: median, floor, median, min: floor },
    load: { mean: 1 },
    dutyCycle: null,
    dutyCycleSource: '',
    calibration: { segments: 2, medianTicksPerMs: 1000, spreadPct: 40 },
    wallRatio: 0.8,
    zeroFraction: 0,
    stationary: true,
    floorMeasurable: true,
    medianTrustworthy: false,
});
const measurement = {
    machine: {
        cpu: 'Fixture',
        hardwareModel: 'Fixture',
        performanceCores: '4',
        efficiencyCores: '0',
        memoryGb: 16,
        os: 'Fixture',
        arch: 'arm64',
        gitBase: 'base',
        workingTree: 'clean',
        takenAt: 'fixture',
        logicalCores: 4,
    },
    sourceRevision: 'fixture',
    sourceDigests: {},
    browser: 'fixture',
    userAgent: 'fixture',
    budgetMs: 2.5,
    options: { warmupQuanta: 4, measureQuanta: 8 },
    load: { before: 1, after: 1 },
    referenceProject: {
        audioThread: [['crumbs', 1]],
        worker: [['grand_boule', 1]],
        audioFloorMs: 0.49,
        audioFloorPartialFrom: [],
        audioUpperBoundMs: 0.55,
        audioWorstQuantumUpperMs: 0.55,
        meanLoad: 1,
        workerFloorMs: 1.6,
        workerMedianMs: 2.2,
    },
    rows: [
        row('crumbs', 'Crumbs fixture', 'audio-thread', 0.49, 0.55),
        row('grand_boule', 'Grand Boule fixture', 'worker', 1.6, 2.2),
    ],
};

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
        expect(rendered).toContain('Crumbs fixture | 490 µs | **550 µs** (unreliable median)');
        expect(rendered).toContain('Grand Boule fixture | 1600 µs | **2200 µs** (unreliable median)');
        expect(rendered).toContain('(unreliable median)');
        expect(rendered).toContain(
            '| **Audio thread, median-based total** | **0.55** | **22%** | unreliable, not an upper bound |'
        );
        expect(rendered).toContain('**NOT DECIDED by compute alone.**');
        expect(rendered).toContain('1 × crumbs');
        expect(rendered).toContain('median is unreliable, not an upper bound');
        expect(rendered).not.toContain('DECIDED: the upper bound already fits.');
        expect(rendered).toContain('| Audio thread, lower bound | 0.49 | 20% |');
    });

    it('qualifies the console reference using the same member flags', () => {
        const render = (data: typeof measurement) =>
            renderConsoleReference(data.rows, data.referenceProject, data.budgetMs);
        const output = render(measurement);
        expect(output).toContain('AUDIO THREAD >= 0.49 ms (20%) lower bound');
        expect(output).toContain('0.55 ms (22%) median-based total (unreliable, not an upper bound)');
        expect(output).toContain('2.2 ms (88%) median (unreliable, not an upper bound)');
        expect(output).toContain('NOT DECIDED: unreliable reference audio medians (crumbs)');
        const trusted = withTrust(true);
        expect(render(trusted)).toContain('DECIDED: the upper bound already fits.');
        rowById(trusted, 'grand_boule').medianTrustworthy = false;
        expect(render(trusted)).toContain('DECIDED: the upper bound already fits.');
        expect(render(trusted)).toContain('median (unreliable, not an upper bound)');
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
