/// <reference types="node" />
import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
    digestContextBoundEvidenceResultRecordV1,
    serializeContextBoundEvidenceResultRecordV1,
    type ContextBoundEvidenceResultRecordV1,
} from './evidenceResultBinding.ts';

const TEMPORARY_NAME = /^\.evidence-result-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;
function fail(): never {
    const error = new Error('evidence result publication failed');
    error.name = 'EvidenceResultStoreError';
    throw error;
}
async function writeTemp(path: string, bytes: Buffer, ownership: { owned: boolean }): Promise<void> {
    const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW;
    const handle = await open(path, flags, 0o600);
    ownership.owned = true;
    try {
        await handle.chmod(0o600);
        await handle.writeFile(bytes);
        await handle.sync();
    } finally {
        await handle.close();
    }
}
function checkFinalStat(stat: Stats, expectedBytes: number, minimumLinks: number, maximumLinks = minimumLinks): void {
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.uid !== process.getuid() ||
        (stat.mode & 0o7777) !== 0o600 ||
        stat.nlink < minimumLinks ||
        stat.nlink > maximumLinks ||
        stat.size !== expectedBytes
    ) {
        fail();
    }
}
async function readFinal(
    path: string,
    expected: Buffer,
    minimumLinks: number,
    maximumLinks = minimumLinks
): Promise<Readonly<Stats>> {
    const before = await lstat(path);
    checkFinalStat(before, expected.length, minimumLinks, maximumLinks);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const opened = await handle.stat();
        checkFinalStat(opened, expected.length, minimumLinks, maximumLinks);
        if (opened.dev !== before.dev || opened.ino !== before.ino) {
            fail();
        }
        const bytes = Buffer.alloc(expected.length + 1);
        let offset = 0;
        while (offset < bytes.length) {
            const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
            if (bytesRead === 0) {
                break;
            }
            offset += bytesRead;
        }
        await handle.sync();
        const after = await handle.stat();
        const namedAfter = await lstat(path);
        checkFinalStat(after, expected.length, minimumLinks, maximumLinks);
        checkFinalStat(namedAfter, expected.length, minimumLinks, maximumLinks);
        if (
            after.dev !== opened.dev ||
            after.ino !== opened.ino ||
            namedAfter.dev !== after.dev ||
            namedAfter.ino !== after.ino ||
            offset !== expected.length ||
            !bytes.subarray(0, offset).equals(expected)
        ) {
            fail();
        }
        return after;
    } finally {
        await handle.close();
    }
}
async function syncDirectory(path: string): Promise<void> {
    const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}
function errorCode(error: unknown): string | null {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
        return error.code;
    }
    return null;
}
function inside(root: string, candidate: string): boolean {
    const path = relative(root, candidate);
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}
async function checkedRoot(repositoryRoot: unknown): Promise<string> {
    if (
        typeof repositoryRoot !== 'string' ||
        repositoryRoot.includes(String.fromCodePoint(0)) ||
        !isAbsolute(repositoryRoot) ||
        resolve(repositoryRoot) !== repositoryRoot
    ) {
        return fail();
    }
    const stat = await lstat(repositoryRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
        return fail();
    }
    const canonical = await realpath(repositoryRoot);
    if (canonical !== repositoryRoot) {
        return fail();
    }
    return canonical;
}
async function checkedDirectory(root: string, parent: string, segment: string): Promise<string> {
    const path = join(parent, segment);
    try {
        await mkdir(path, { mode: 0o700 });
    } catch (error) {
        if (errorCode(error) !== 'EEXIST') {
            return fail();
        }
    }
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
        return fail();
    }
    const canonical = await realpath(path);
    if (canonical !== path || !inside(root, canonical)) {
        return fail();
    }
    await syncDirectory(parent);
    return canonical;
}
async function removeTemporary(path: string | null): Promise<void> {
    if (!path) {
        return;
    }
    try {
        await unlink(path);
    } catch (error) {
        if (errorCode(error) !== 'ENOENT') {
            fail();
        }
    }
}
/**
 * POSIX publisher: the runner must hold exclusive repository-tree control and be its sole publisher process; calls
 * in this process are serialized below. Existing symlinks and observed final swaps fail closed; concurrent same-user
 * ancestor replacement is outside Node pathname guarantees. A crash before pending promotion may leave a harmless
 * unique stage for retention; the digest-addressed pending link is the post-promotion recovery anchor.
 */
async function publishExclusive(input: {
    readonly repositoryRoot: unknown;
    readonly record: ContextBoundEvidenceResultRecordV1;
}) {
    let temporaryPath: string | null = null;
    let pendingPath: string | null = null;
    let directoryPath: string | null = null;
    const temporaryOwnership = { owned: false };
    let pendingTrusted = false;
    try {
        const source = serializeContextBoundEvidenceResultRecordV1(input.record);
        const bytes = Buffer.from(source);
        const sha256 = digestContextBoundEvidenceResultRecordV1(input.record);
        const root = await checkedRoot(input.repositoryRoot);
        let directory = root;
        for (const segment of ['evidence', 'agent-campaign', 'runs', input.record.integratedCommit]) {
            directory = await checkedDirectory(root, directory, segment);
        }
        directoryPath = directory;
        const repoRelativePath = `evidence/agent-campaign/runs/${input.record.integratedCommit}/${input.record.gateOrSuiteId}.json`;
        const finalPath = join(root, repoRelativePath);
        if (!inside(root, finalPath) || resolve(finalPath) !== finalPath) {
            return fail();
        }
        const temporaryName = `.evidence-result-${randomUUID()}.tmp`;
        if (!TEMPORARY_NAME.test(temporaryName)) {
            return fail();
        }
        temporaryPath = join(directory, temporaryName);
        await writeTemp(temporaryPath, bytes, temporaryOwnership);
        pendingPath = join(directory, `.evidence-result-${sha256}.pending`);
        let disposition: 'created' | 'existing' | null = null;
        let published: Readonly<Stats> | null = null;
        try {
            await link(temporaryPath, pendingPath);
            pendingTrusted = true;
            await readFinal(pendingPath, bytes, 2);
        } catch (error) {
            if (errorCode(error) !== 'EEXIST') {
                throw error;
            }
            const pending = await readFinal(pendingPath, bytes, 1, 2);
            pendingTrusted = true;
            if (pending.nlink === 2) {
                try {
                    published = await readFinal(finalPath, bytes, 1, 2);
                    disposition = 'existing';
                } catch (finalError) {
                    if (errorCode(finalError) !== 'ENOENT') {
                        throw finalError;
                    }
                    await removeTemporary(pendingPath);
                    pendingTrusted = false;
                    await syncDirectory(directory);
                    await link(temporaryPath, pendingPath);
                    pendingTrusted = true;
                    await readFinal(pendingPath, bytes, 2);
                }
            }
        }
        await syncDirectory(directory);
        await removeTemporary(temporaryPath);
        temporaryOwnership.owned = false;
        temporaryPath = null;
        await syncDirectory(directory);
        if (!disposition) {
            await readFinal(pendingPath, bytes, 1);
            try {
                await link(pendingPath, finalPath);
                disposition = 'created';
            } catch (error) {
                if (errorCode(error) !== 'EEXIST') {
                    throw error;
                }
                disposition = 'existing';
            }
            published = await readFinal(finalPath, bytes, 1, 2);
            await syncDirectory(directory);
        }
        await removeTemporary(pendingPath);
        pendingTrusted = false;
        pendingPath = null;
        await syncDirectory(directory);
        const durable = await readFinal(finalPath, bytes, 1);
        if (!published || durable.dev !== published.dev || durable.ino !== published.ino) {
            fail();
        }
        return Object.freeze({ disposition, repoRelativePath, sha256 });
    } catch {
        try {
            await removeTemporary(temporaryOwnership.owned ? temporaryPath : null);
            await removeTemporary(pendingTrusted ? pendingPath : null);
            if (directoryPath) {
                await syncDirectory(directoryPath);
            }
        } catch {
            // The fixed outer error remains the only observable failure.
        }
        return fail();
    }
}

let publicationQueue: Promise<void> = Promise.resolve();
const settlePublication = (): void => undefined;
export function publishEvidenceResultRecordV1(input: Parameters<typeof publishExclusive>[0]) {
    const result = publicationQueue.then(() => publishExclusive(input));
    publicationQueue = result.then(settlePublication, settlePublication);
    return result;
}
