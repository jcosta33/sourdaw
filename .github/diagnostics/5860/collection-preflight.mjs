import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyCollection(output, baseline) {
    const lines = output.split(/\r?\n/).filter((line) => /^  \[/.test(line));
    const entries = lines.map((line) => {
        const match = /^  \[([^\]]+)\] › (.+):(\d+):\d+ › (.+)$/.exec(line);
        assert.ok(match, `Unrecognized test listing: ${line}`);
        const file = match[2].split('/').at(-1);
        return { project: match[1], file, line: Number(match[3]), title: [file, ...match[4].split(' › ')] };
    });
    assert.equal(entries.length, baseline.count);
    assert.match(output, /Total: 81 tests in \d+ files?/);
    assert.ok(
        entries.some((entry) => JSON.stringify(entry) === JSON.stringify(baseline.target)),
        'Target absent'
    );
    assert.equal(createHash('sha256').update(JSON.stringify(entries)).digest('hex'), baseline.sha256);
}

async function main() {
    const baseline = JSON.parse(readFileSync(process.env.CAPTURE_BASELINE, 'utf8'));
    const { selectedSpecArguments } = await import(`${process.cwd()}/scripts/prValidationScope.ts`);
    const selectors = selectedSpecArguments(baseline.specs, process.cwd());
    const result = spawnSync('pnpm', ['test:e2e', ...selectors, '--list', '--reporter=line'], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
    });
    writeFileSync(process.env.LIST_RECEIPT, `${result.stdout ?? ''}${result.stderr ?? ''}`);
    assert.equal(result.status, 0, String(result.error ?? result.stderr));
    verifyCollection(result.stdout, baseline);
    console.log(`Verified ${baseline.count} cases in original order`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
