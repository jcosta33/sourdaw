import {
    chmod,
    link,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    realpath,
    rm,
    stat,
    symlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createEvidencePolicy } from '../evidenceContract';
import {
    bindEvidenceResultRecordV1,
    digestContextBoundEvidenceResultRecordV1,
    serializeContextBoundEvidenceResultRecordV1,
    type ContextBoundEvidenceResultRecordV1,
} from '../evidenceResultBinding';
import { validateEvidenceResultRecordV1 } from '../evidenceResultRecord';
import { publishEvidenceResultRecordV1 } from '../evidenceResultStore';

const roots: string[] = [];
const FIXED_ERROR = 'EvidenceResultStoreError: evidence result publication failed';
const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const packageSha256 = createEvidencePolicy().identity.governingHashes.campaignIndex;
async function repository(): Promise<string> {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'sourdaw-evidence-store-')));
    roots.push(root);
    return root;
}
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function recordInput(aggregates: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        schemaVersion: 1,
        resultId: 'result.AC-060',
        gateOrSuiteId: 'AC-060',
        integratedCommit: 'b'.repeat(40),
        policySha256: 'a'.repeat(64),
        packageSha256,
        runEnvelopeSha256: 'd'.repeat(64),
        fixtureIds: ['fixture-one'],
        status: 'passed',
        startedAt: '2026-07-27T10:00:00.000Z',
        endedAt: '2026-07-27T10:00:01.000Z',
        exitStatus: { kind: 'exit', code: 0 },
        stdoutSha256: emptyHash,
        stderrSha256: emptyHash,
        assertionTotals: { passed: 1, failed: 0, notApplicable: 0, total: 1 },
        metricSamples: [],
        aggregates,
        rawSamplePaths: [],
        environmentMatch: true,
        capabilityDecision: 'applicable',
        reviewerDisposition: 'accepted',
    };
}
function bound(aggregates: Record<string, unknown> = {}): ContextBoundEvidenceResultRecordV1 {
    const record = validateEvidenceResultRecordV1(recordInput(aggregates));
    return bindEvidenceResultRecordV1(record, {
        schemaVersion: 1,
        resultId: record.resultId,
        gateOrSuiteId: record.gateOrSuiteId,
        integratedCommit: record.integratedCommit,
        policySha256: record.policySha256,
        packageSha256: record.packageSha256,
        runEnvelopeSha256: record.runEnvelopeSha256,
        declaredFixtureIds: ['fixture-one'],
        expectedCapabilityDecision: 'applicable',
    });
}
const publish = (repositoryRoot: string, record = bound()) => publishEvidenceResultRecordV1({ repositoryRoot, record });
const rejection = async (operation: () => Promise<unknown>): Promise<string> => {
    try {
        await operation();
        return '';
    } catch (error) {
        return String(error);
    }
};
const destination = (root: string): string =>
    join(root, 'evidence', 'agent-campaign', 'runs', 'b'.repeat(40), 'AC-060.json');
async function temporaryNames(root: string): Promise<string[]> {
    const directory = dirname(destination(root));
    try {
        return (await readdir(directory)).filter((name) => name.endsWith('.tmp'));
    } catch {
        return [];
    }
}

describe('immutable evidence result store', () => {
    it('should publish exact durable canonical bytes with a redacted frozen receipt and private mode', async () => {
        const root = await repository();
        const record = bound();
        const receipt = await publish(root, record);
        const path = destination(root);
        expect(receipt).toEqual({
            disposition: 'created',
            repoRelativePath: `evidence/agent-campaign/runs/${'b'.repeat(40)}/AC-060.json`,
            sha256: digestContextBoundEvidenceResultRecordV1(record),
        });
        const published = await stat(path);
        expect([
            Object.isFrozen(receipt),
            await readFile(path, 'utf8'),
            published.mode & 0o7777,
            published.uid,
            published.nlink,
        ]).toEqual([true, serializeContextBoundEvidenceResultRecordV1(record), 0o600, process.getuid(), 1]);
        expect(await temporaryNames(root)).toEqual([]);
    });
    it('should make sequential and concurrent identical publication idempotent', async () => {
        const root = await repository();
        const record = bound();
        const first = await publish(root, record);
        const second = await publish(root, record);
        const concurrentRoot = await repository();
        const concurrent = await Promise.all([publish(concurrentRoot, record), publish(concurrentRoot, record)]);
        expect([
            first.disposition,
            second.disposition,
            ...concurrent.map(({ disposition }) => disposition).sort(),
        ]).toEqual(['created', 'existing', 'created', 'existing']);
        expect(await temporaryNames(concurrentRoot)).toEqual([]);
    });
    it('should preserve exactly one winner for sequential and concurrent different records', async () => {
        const first = bound({ version: 1 });
        const second = bound({ version: 2 });
        const sequentialRoot = await repository();
        await publish(sequentialRoot, first);
        const sequentialError = await rejection(() => publish(sequentialRoot, second));
        expect([sequentialError, await readFile(destination(sequentialRoot), 'utf8')]).toEqual([
            FIXED_ERROR,
            serializeContextBoundEvidenceResultRecordV1(first),
        ]);
        const concurrentRoot = await repository();
        const settled = await Promise.allSettled([publish(concurrentRoot, first), publish(concurrentRoot, second)]);
        expect(settled.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
        const winner = await readFile(destination(concurrentRoot), 'utf8');
        expect([
            serializeContextBoundEvidenceResultRecordV1(first),
            serializeContextBoundEvidenceResultRecordV1(second),
        ]).toContain(winner);
        expect(await temporaryNames(concurrentRoot)).toEqual([]);
    });
    it('should reject symlink, non-directory, and ambiguous root/final paths without following them', async () => {
        const record = bound();
        const realRoot = await repository();
        const linkRoot = `${realRoot}-link`;
        roots.push(linkRoot);
        await symlink(realRoot, linkRoot, 'dir');
        const fileRoot = join(await repository(), 'root-file');
        await writeFile(fileRoot, 'private-token');
        const intermediateRoot = await repository();
        const outside = await repository();
        await mkdir(join(intermediateRoot, 'evidence'));
        await symlink(outside, join(intermediateRoot, 'evidence', 'agent-campaign'), 'dir');
        const finalRoot = await repository();
        await mkdir(dirname(destination(finalRoot)), { recursive: true });
        const privateFile = join(outside, 'private-token');
        await writeFile(privateFile, 'private-token');
        await symlink(privateFile, destination(finalRoot));
        const ambiguousRoot = `${realRoot}/../${basename(realRoot)}`;
        const errors = await Promise.all(
            [linkRoot, fileRoot, intermediateRoot, finalRoot, ambiguousRoot].map((repositoryRoot) =>
                rejection(() => publish(repositoryRoot, record))
            )
        );
        expect(errors.every((error) => error === FIXED_ERROR)).toBe(true);
        expect(await readFile(privateFile, 'utf8')).toBe('private-token');
        expect(errors.join()).not.toContain('private-token');
    });
    it('should reject oversized existing results without replacing or leaking temporary files', async () => {
        const record = bound();
        const oversizedRoot = await repository();
        await mkdir(dirname(destination(oversizedRoot)), { recursive: true });
        await writeFile(destination(oversizedRoot), Buffer.alloc(262_145, 1));
        await chmod(destination(oversizedRoot), 0o600);
        const oversizedError = await rejection(() => publish(oversizedRoot, record));
        expect([oversizedError, (await stat(destination(oversizedRoot))).size]).toEqual([FIXED_ERROR, 262_145]);
        expect(await temporaryNames(oversizedRoot)).toEqual([]);
    });
    it('should reject unsafe mode and external hard links on existing results', async () => {
        const modeRoot = await repository();
        await publish(modeRoot);
        await chmod(destination(modeRoot), 0o644);
        const modeError = await rejection(() => publish(modeRoot));
        const linkRoot = await repository();
        await publish(linkRoot);
        await link(destination(linkRoot), join(linkRoot, 'external-hard-link'));
        const linkError = await rejection(() => publish(linkRoot));
        const finalLinks = (await stat(destination(linkRoot))).nlink;
        expect([modeError, linkError, finalLinks]).toEqual([FIXED_ERROR, FIXED_ERROR, 2]);
        expect([await temporaryNames(modeRoot), await temporaryNames(linkRoot)]).toEqual([[], []]);
    });
    it('should replace stale-stage nlink2 pending while retaining the harmless stale stage', async () => {
        const root = await repository();
        const record = bound();
        const bytes = serializeContextBoundEvidenceResultRecordV1(record);
        const finalPath = destination(root);
        const directory = dirname(finalPath);
        const digest = digestContextBoundEvidenceResultRecordV1(record);
        const pending = join(directory, `.evidence-result-${digest}.pending`);
        const staleStage = join(directory, '.evidence-result-00000000-0000-4000-8000-000000000000.tmp');
        await mkdir(directory, { recursive: true });
        await writeFile(staleStage, bytes, { mode: 0o600 });
        await link(staleStage, pending);
        expect((await stat(pending)).nlink).toBe(2);
        const receipt = await publish(root, record);
        const finalStat = await stat(finalPath);
        const staleStat = await stat(staleStage);
        expect(receipt.disposition).toBe('created');
        expect(await readFile(finalPath, 'utf8')).toBe(bytes);
        expect(finalStat.nlink).toBe(1);
        expect(staleStat.nlink).toBe(1);
        expect(staleStat.ino).not.toBe(finalStat.ino);
        expect(await readFile(staleStage, 'utf8')).toBe(bytes);
        expect(await readdir(directory)).not.toContain(basename(pending));
        expect(await temporaryNames(root)).toEqual([basename(staleStage)]);
    });
    it('should recover final and pending nlink2 while preserving the published inode', async () => {
        const root = await repository();
        const record = bound();
        const bytes = serializeContextBoundEvidenceResultRecordV1(record);
        const finalPath = destination(root);
        const directory = dirname(finalPath);
        const pending = join(directory, `.evidence-result-${digestContextBoundEvidenceResultRecordV1(record)}.pending`);
        await publish(root, record);
        const original = await stat(finalPath);
        await link(finalPath, pending);
        const linkedPending = await stat(pending);
        expect([linkedPending.ino, linkedPending.nlink]).toEqual([original.ino, 2]);
        const receipt = await publish(root, record);
        const recovered = await stat(finalPath);
        expect(receipt.disposition).toBe('existing');
        expect(recovered.ino).toBe(original.ino);
        expect(await readFile(finalPath, 'utf8')).toBe(bytes);
        expect(recovered.nlink).toBe(1);
        expect(await readdir(directory)).not.toContain(basename(pending));
        expect(await temporaryNames(root)).toEqual([]);
    });
    it('should reject a structural-only cast and normalize real filesystem failures', async () => {
        const structural = validateEvidenceResultRecordV1(recordInput());
        const forged = structural as ContextBoundEvidenceResultRecordV1;
        const forgedRoot = await repository();
        expect(await rejection(() => publish(forgedRoot, forged))).toBe(FIXED_ERROR);
        const readOnlyRoot = await repository();
        await mkdir(dirname(destination(readOnlyRoot)), { recursive: true });
        await chmod(dirname(destination(readOnlyRoot)), 0o500);
        const error = await rejection(() => publish(readOnlyRoot));
        await chmod(dirname(destination(readOnlyRoot)), 0o700);
        expect([error, await temporaryNames(readOnlyRoot)]).toEqual([FIXED_ERROR, []]);
    });
});
