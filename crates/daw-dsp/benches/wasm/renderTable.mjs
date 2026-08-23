#!/usr/bin/env node
/**
 * Regenerate the numeric sections of `benches/quantum-cost-table.md` from the
 * retained `benches/quantum-cost-table.json`.
 *
 *     node crates/daw-dsp/benches/wasm/renderTable.mjs
 *
 * Every figure in the published table is written by this script from the JSON
 * the run emitted. No number in that document is typed by hand.
 *
 * That is not tidiness. The first version of this table hand-transcribed every
 * figure from console output that was never committed, which meant two later
 * questions — was that p95 credible, was that occupancy check real — could not
 * be settled from the artifact at all, only re-litigated by re-running. The
 * JSON is the primary record; the markdown is a rendering of it; and the prose
 * around the generated block is the only part a human writes.
 *
 * The generated region is delimited by `<!-- generated:begin -->` and
 * `<!-- generated:end -->`. Prose outside those markers is preserved.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const jsonPath = resolve(here, '../quantum-cost-table.json');
const mdPath = resolve(here, '../quantum-cost-table.md');

const BEGIN = '<!-- generated:begin -->';
const END = '<!-- generated:end -->';

export const GENERATED_BEGIN = BEGIN;
export const GENERATED_END = END;

export function renderGeneratedRegion(data) {
    const budget = data.budgetMs;

    /** Two significant figures. The clock does not sustain more. */
    const sig2 = (value) => (Number.isFinite(value) && value !== 0 ? Number(value.toPrecision(2)).toString() : '0');
    const us = (ms) => sig2(ms * 1000);
    const pct = (ms) => `${sig2((ms / budget) * 100)}%`;

    const audioRows = data.rows.filter((row) => row.costSite === 'audio-thread');
    const otherRows = data.rows.filter((row) => row.costSite !== 'audio-thread');

    const deviceTable = (rows) => {
        const lines = [
            '| Device | ≥ floor | ≤ upper bound | upper as % of budget | load | clock stalls | steady? |',
            '| --- | ---: | ---: | ---: | ---: | ---: | :---: |',
        ];
        for (const row of [...rows].sort((a, b) => b.stats.median - a.stats.median)) {
            const floorCell = row.floorMeasurable ? `${us(row.stats.floor)} µs` : '—';
            lines.push(
                `| ${row.label} | ${floorCell} | **${us(row.stats.median)} µs** | **${pct(row.stats.median)}** | ` +
                    `${row.load.mean.toFixed(0)} | ${(row.zeroFraction * 100).toFixed(1)}% | ` +
                    `${row.stationary ? 'yes' : '**no**'} |`
            );
        }
        return lines.join('\n');
    };

    const dutyRows = data.rows.filter((row) => row.dutyCycle !== null);
    const dutyTable = () => {
        const lines = [
            '| Device | period | duty | cost in the tick | cost otherwise | amortised mean | period comes from |',
            '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
        ];
        for (const row of dutyRows) {
            const d = row.dutyCycle;
            lines.push(
                `| ${row.id} | every ${d.periodQuanta} quanta | ${sig2(d.dutyPct)}% | ` +
                    `${us(d.tickCostMs)} µs (${pct(d.tickCostMs)}) | ${us(d.idleCostMs)} µs | ` +
                    `**${us(d.amortisedMeanMs)} µs (${pct(d.amortisedMeanMs)})** | \`${row.dutyCycleSource}\` |`
            );
        }
        return lines.join('\n');
    };

    const ref = data.referenceProject;
    const refList = (members) => members.map(([id, count]) => `${count} × ${id}`).join(', ');

    const calibrationTable = () => {
        const lines = [
            '| Device | segments | ticks/ms (median) | rate spread | compute ÷ wall | raw min | floor (p1) |',
            '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        ];
        for (const row of data.rows) {
            lines.push(
                `| ${row.id} | ${row.calibration.segments} | ${sig2(row.calibration.medianTicksPerMs)} | ` +
                    `${row.calibration.spreadPct.toFixed(1)}% | ${(row.wallRatio * 100).toFixed(0)}% | ` +
                    `${us(row.stats.min)} µs | ${row.floorMeasurable ? us(row.stats.floor) + ' µs' : 'withheld'} |`
            );
        }
        return lines.join('\n');
    };

    const occupancyList = () =>
        data.rows
            .map(
                (row) =>
                    `- **${row.id}** — after warmup: ${row.warmVerify.detail}; ` +
                    `after the timed run: ${row.lateVerify.detail}`
            )
            .join('\n');
    const sourceDigestList = () =>
        Object.entries(data.sourceDigests)
            .map(([path, digest]) => `- \`${path}\`: \`sha256:${digest}\``)
            .join('\n');

    const nonAudioThreadSection =
        otherRows.length === 0
            ? ''
            : '\n### Production cost is not on the audio thread — measured kernel cost, separate budget\n\n' +
              deviceTable(otherRows) +
              '\n';

    const workerReference = ref.worker === undefined ? '' : `\nWorker: ${refList(ref.worker)}.`;
    const workerReferenceRow =
        ref.worker === undefined
            ? ''
            : `| Worker — Grand Boule DSP | ${sig2(ref.workerFloorMs)} – ${sig2(ref.workerMedianMs)} | ${pct(ref.workerFloorMs)} – ${pct(ref.workerMedianMs)} | separate thread and ring |`;

    return `${BEGIN}
<!-- Generated by benches/wasm/renderTable.mjs from benches/quantum-cost-table.json.
     Do not hand-edit anything between these markers. -->

### Provenance

| | |
| --- | --- |
| Machine | ${data.machine.cpu} (\`${data.machine.hardwareModel}\`), ${data.machine.performanceCores}P + ${data.machine.efficiencyCores}E, ${data.machine.memoryGb} GB |
| OS | ${data.machine.os}, ${data.machine.arch} |
| Browser | **${data.browser}** (Google Chrome stable, headless) |
| User agent | \`${data.userAgent}\` |
| **Commit measured** | **\`${data.sourceRevision}\`** |
| Base it sits on | \`${data.machine.gitBase}\` |
| Working tree | ${data.machine.workingTree} |
| Taken | ${data.machine.takenAt} |
| Machine load | ${data.load.before.toFixed(2)} before, ${data.load.after.toFixed(2)} after — **recorded, not gated** |
| Warm-up / samples | ${data.options.warmupQuanta} discarded, ${data.options.measureQuanta} timed quanta per row |
| Budget | ${budget.toFixed(4)} ms = 128 frames ÷ 48 kHz |

Measured-source digests:

${sourceDigestList()}

### On the audio thread — these share the one ${budget.toFixed(3)} ms deadline

\`≥ floor\` is a lower bound and \`≤ upper bound\` is an upper bound; both are valid under the load shown.
A dash means the clock stalled too often on that row for a floor to mean anything — the upper bound stands.

${deviceTable(audioRows)}
${nonAudioThreadSection}

### Duty cycles, not tails

${dutyTable()}

### The reference project

Audio thread: ${refList(ref.audioThread)}.
${workerReference}

Measured at a mean 1-minute load average of **${ref.meanLoad.toFixed(0)}** on ${data.machine.logicalCores} logical
cores. Both bounds are valid under that load; see the note on direction above.

| | ms | % of ${budget.toFixed(3)} ms | |
| --- | ---: | ---: | --- |
| Audio thread, lower bound | ${sig2(ref.audioFloorMs)} | ${pct(ref.audioFloorMs)} | partial — no floor from ${ref.audioFloorPartialFrom.length} rows, counted as zero |
| **Audio thread, upper bound** | **${sig2(ref.audioUpperBoundMs)}** | **${pct(ref.audioUpperBoundMs)}** | **the decisive figure** |
| Audio thread, worst quantum, upper bound | ${sig2(ref.audioWorstQuantumUpperMs)} | ${pct(ref.audioWorstQuantumUpperMs)} | + the largest single duty spike |
${workerReferenceRow}

**${ref.audioWorstQuantumUpperMs < budget ? 'DECIDED: the upper bound already fits.' : 'NOT DECIDED by compute alone.'}**
${
    ref.audioWorstQuantumUpperMs < budget
        ? `Even measured under a load average of ${ref.meanLoad.toFixed(0)}, the reference project's audio thread does not ` +
          'approach the deadline on compute, and a quieter machine can only lower these numbers. Compute is not the ' +
          'obstacle. Whether quanta are actually missed is a different question, and AC-3 owns it.'
        : 'The bounds straddle the budget on this machine.'
}

### Occupancy, verified after each timed run

${occupancyList()}

### Clock, per row

${calibrationTable()}

${END}`;
}

function generatedRegion(markdown) {
    const start = markdown.indexOf(BEGIN);
    const finish = markdown.indexOf(END, start + BEGIN.length);
    if (start < 0 || finish < 0 || finish < start) {
        throw new Error(`markdown has no generated region; add ${BEGIN} / ${END} markers`);
    }
    return markdown.slice(start, finish + END.length);
}

export function replaceGeneratedRegion(markdown, data) {
    const start = markdown.indexOf(BEGIN);
    const finish = markdown.indexOf(END, start + BEGIN.length);
    if (start < 0 || finish < 0 || finish < start) {
        throw new Error(`markdown has no generated region; add ${BEGIN} / ${END} markers`);
    }
    return `${markdown.slice(0, start)}${renderGeneratedRegion(data)}${markdown.slice(finish + END.length)}`;
}

export function assertGeneratedRegionMatches(markdown, data) {
    const actual = generatedRegion(markdown);
    const expected = renderGeneratedRegion(data);
    if (actual !== expected) {
        throw new Error('measurement Markdown generated region does not match JSON rendering');
    }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const md = readFileSync(mdPath, 'utf8');
    if (process.argv.includes('--check')) {
        assertGeneratedRegionMatches(md, data);
        console.log(`measurement tables are current in ${mdPath}`);
    } else {
        writeFileSync(mdPath, replaceGeneratedRegion(md, data));
        console.log(`regenerated the tables in ${mdPath} from ${jsonPath}`);
    }
}
