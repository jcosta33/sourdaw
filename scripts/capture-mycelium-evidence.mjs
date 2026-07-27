import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'docs/evidence/mycelium-ascendant');
const playwright = resolve(root, 'node_modules/.bin/playwright');
const config = 'tests/e2e/playwright.mycelium.config.cjs';
const targets = {
    render: {
        spec: 'tests/e2e/myceliumExport.spec.ts',
        attachment: 'mycelium-wav-evidence',
        output: 'render-evidence.json',
    },
    automation: {
        spec: 'tests/e2e/myceliumAutomationStems.spec.ts',
        attachment: 'mycelium-automation-stem-evidence',
        output: 'automation-stem-evidence.json',
    },
    desktop: {
        spec: 'tests/e2e/myceliumDesktopRuntime.spec.ts',
        attachment: 'mycelium-desktop-runtime-log',
        output: 'desktop-runtime-evidence.json',
    },
};

function attachmentBodies(report, name) {
    const bodies = [];
    function visit(suites) {
        for (const suite of suites ?? []) {
            visit(suite.suites);
            for (const spec of suite.specs ?? []) {
                for (const test of spec.tests ?? []) {
                    for (const result of test.results ?? []) {
                        for (const attachment of result.attachments ?? []) {
                            if (attachment.name === name && typeof attachment.body === 'string') {
                                bodies.push(attachment.body);
                            }
                        }
                    }
                }
            }
        }
    }
    visit(report.suites);
    return bodies;
}

function capture(name) {
    const target = targets[name];
    const run = spawnSync(playwright, ['test', target.spec, `--config=${config}`, '--workers=1', '--reporter=json'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
    });
    if (run.error || run.status !== 0) {
        process.stderr.write(run.stderr);
        process.stderr.write(run.stdout);
        throw run.error ?? new Error(`${name} evidence E2E exited ${String(run.status)}`);
    }
    const report = JSON.parse(run.stdout);
    if (report.stats?.expected !== 1 || report.stats?.unexpected !== 0 || report.stats?.flaky !== 0) {
        throw new Error(`${name} evidence E2E did not produce one decisive pass`);
    }
    const bodies = attachmentBodies(report, target.attachment);
    if (bodies.length !== 1) {
        throw new Error(`${name} evidence E2E produced ${bodies.length} matching receipts`);
    }
    const payload = JSON.parse(Buffer.from(bodies[0], 'base64').toString('utf8'));
    if (payload.sourceDirty !== false) {
        throw new Error(`${name} evidence was captured from a dirty source scope`);
    }
    const receipt = {
        ...payload,
        receiptSha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    };
    writeFileSync(resolve(outputDirectory, target.output), `${JSON.stringify(receipt, null, 4)}\n`, 'utf8');
    return {
        target: name,
        sourceRevision: receipt.sourceRevision,
        sourceTreeSha256: receipt.sourceTreeSha256,
        projectSha256: receipt.projectSha256,
        receiptSha256: receipt.receiptSha256,
        durationMs: report.stats.duration,
    };
}

const requested = process.argv[2] ?? 'all';
const selected = requested === 'all' ? Object.keys(targets) : [requested];
if (selected.some((name) => !(name in targets))) {
    throw new Error('Use render, automation, desktop, or all');
}

mkdirSync(outputDirectory, { recursive: true });
const results = [];
try {
    for (const name of selected) {
        results.push(capture(name));
    }
} finally {
    rmSync(resolve(root, 'test-results'), { recursive: true, force: true });
    rmSync(resolve(root, 'playwright-report'), { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify({ ok: true, results })}\n`);
