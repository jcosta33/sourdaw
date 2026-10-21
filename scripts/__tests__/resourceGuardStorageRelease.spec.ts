import { randomUUID } from 'node:crypto';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    createGuardStorage,
    type reclaimGuardStorage,
    type StorageProcessIdentity,
    type StorageRecoveryPorts,
} from '../resourceGuardStorage';

const roots: string[] = [];

function fixture(): string {
    const fixtures = resolve('.agents/guard-storage-fixtures');
    mkdirSync(fixtures, { recursive: true });
    const root = mkdtempSync(join(fixtures, 'release-'));
    roots.push(root);
    return root;
}

function fileIdentity(path: string): { dev: bigint; ino: bigint } {
    const { dev, ino } = lstatSync(path, { bigint: true });
    return { dev, ino };
}

afterEach(() => {
    for (const root of roots) {
        rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
});

describe('guard storage local release continuation', () => {
    it('reclaims its retained claim when a later release proves the relocated payload removable', async () => {
        const root = fixture();
        const sentinel = join(root, 'unowned-sentinel');
        writeFileSync(sentinel, 'unowned storage must survive');
        const sentinelIdentity = fileIdentity(sentinel);
        let relocatedRemovalAllowed = false;
        const proofPaths: Array<string | undefined> = [];
        const ports: StorageRecoveryPorts = {
            identityState: () => 'alive',
            sessionState: () => 'unknown',
            localReleaseAllowed: (_owner, original, current) => {
                proofPaths.push(current);
                return current === original || relocatedRemovalAllowed;
            },
        };
        const token = randomUUID();
        const storage = createGuardStorage({
            root,
            token,
            owner: { pid: process.pid, startedAt: 'release-continuation-fixture' },
            ports,
        });
        const originalPayload = dirname(storage.tempDirectory);
        const payloadIdentity = fileIdentity(originalPayload);
        const originalFile = join(storage.tempDirectory, 'owned-payload');
        writeFileSync(originalFile, 'owned storage payload');
        const ownedFileIdentity = fileIdentity(originalFile);

        await expect(storage.release(true)).resolves.toBe(false);

        expect(existsSync(originalPayload)).toBe(false);
        const claimsRoot = join(root, '.claims');
        const claims = readdirSync(claimsRoot);
        expect(claims).toHaveLength(1);
        const claimToken = claims[0];
        if (claimToken === undefined) {
            throw new Error('the first release must retain its payload in a claim');
        }
        const claim = join(claimsRoot, claimToken);
        const claimedPayload = join(claim, token);
        const claimedFile = join(claimedPayload, 'tmp', 'owned-payload');
        expect(readdirSync(claim).sort()).toEqual(['claim.json', token].sort());
        expect(fileIdentity(claimedPayload)).toEqual(payloadIdentity);
        expect(fileIdentity(claimedFile)).toEqual(ownedFileIdentity);
        expect(readFileSync(claimedFile, 'utf8')).toBe('owned storage payload');
        expect(proofPaths).toEqual([storage.tempDirectory, join(claimedPayload, 'tmp')]);

        relocatedRemovalAllowed = true;
        await expect(storage.release(true)).resolves.toBe(true);

        expect(existsSync(claimedFile)).toBe(false);
        expect(existsSync(claimedPayload)).toBe(false);
        expect(existsSync(claim)).toBe(false);
        expect(readdirSync(claimsRoot)).toEqual([]);
        expect(fileIdentity(sentinel)).toEqual(sentinelIdentity);
        expect(readFileSync(sentinel, 'utf8')).toBe('unowned storage must survive');
    });
});

function payloadSnapshot(payload: string) {
    const file = join(payload, 'tmp', 'owned-payload');
    return {
        identity: fileIdentity(payload),
        fileIdentity: fileIdentity(file),
        contents: readFileSync(file, 'utf8'),
    };
}

function expectPayload(payload: string, expected: ReturnType<typeof payloadSnapshot>): void {
    expect(payloadSnapshot(payload)).toEqual(expected);
}

function releaseFixture(
    ports: StorageRecoveryPorts,
    owner: StorageProcessIdentity = { pid: process.pid, startedAt: 'release-safety-fixture' }
) {
    const root = fixture();
    const sentinel = join(root, 'unowned-sentinel');
    const sentinelContents = 'unowned storage must survive';
    writeFileSync(sentinel, sentinelContents);
    const sentinelIdentity = fileIdentity(sentinel);
    const token = randomUUID();
    const storage = createGuardStorage({
        root,
        token,
        owner,
        ports,
    });
    writeFileSync(join(storage.tempDirectory, 'owned-payload'), 'owned storage payload');
    return {
        root,
        token,
        storage,
        owned: payloadSnapshot(dirname(storage.tempDirectory)),
        sentinel,
        sentinelIdentity,
        sentinelContents,
    };
}

function expectUnownedSentinel(input: ReturnType<typeof releaseFixture>): void {
    expect(fileIdentity(input.sentinel)).toEqual(input.sentinelIdentity);
    expect(readFileSync(input.sentinel, 'utf8')).toBe(input.sentinelContents);
}

function retainedClaim(root: string, token: string) {
    const claimsRoot = join(root, '.claims');
    const tokens = readdirSync(claimsRoot);
    expect(tokens).toHaveLength(1);
    const claimToken = tokens[0];
    if (claimToken === undefined) {
        throw new Error('a refused relocated release must retain exactly one claim');
    }
    const path = join(claimsRoot, claimToken);
    expect(readdirSync(path).sort()).toEqual(['claim.json', token].sort());
    return { path, payload: join(path, token), record: join(path, 'claim.json') };
}

describe('retained guard storage release safety', () => {
    it('preserves Linux start ticks in the retained claim through successful continuation', async () => {
        const owner = { pid: process.pid, startedAt: 'release-start-ticks-fixture', startTicks: 123456 };
        let allowRelocated = false;
        const input = releaseFixture(
            {
                identityState: () => 'alive',
                sessionState: () => 'unknown',
                localReleaseAllowed: (_owner, original, current) => current === original || allowRelocated,
            },
            owner
        );

        await expect(input.storage.release(true)).resolves.toBe(false);
        const claim = retainedClaim(input.root, input.token);
        const record: NonNullable<Parameters<typeof reclaimGuardStorage>[0]['sourceClaim']> = JSON.parse(
            readFileSync(claim.record, 'utf8')
        );
        expect(record.reclaimer).toEqual(owner);
        expect(record.run.owner).toEqual(owner);
        expectPayload(claim.payload, input.owned);
        expectUnownedSentinel(input);

        allowRelocated = true;
        await expect(input.storage.release(true)).resolves.toBe(true);
        expect(existsSync(claim.payload)).toBe(false);
        expect(existsSync(claim.path)).toBe(false);
        expect(readdirSync(join(input.root, '.claims'))).toEqual([]);
        expectUnownedSentinel(input);
    });

    it('continues after another post-rename veto, removes old empty wrappers, and stays complete', async () => {
        let permittedSource: string | undefined;
        let allowRelocated = false;
        const input = releaseFixture({
            identityState: () => 'alive',
            sessionState: () => 'unknown',
            localReleaseAllowed: (_owner, original, current) =>
                current === original || current === permittedSource || allowRelocated,
        });

        await expect(input.storage.release(true)).resolves.toBe(false);
        const first = retainedClaim(input.root, input.token);
        expectPayload(first.payload, input.owned);
        expectUnownedSentinel(input);

        permittedSource = join(first.payload, 'tmp');
        await expect(input.storage.release(true)).resolves.toBe(false);
        const second = retainedClaim(input.root, input.token);
        expect(second.path).not.toBe(first.path);
        expect(existsSync(first.path)).toBe(false);
        expectPayload(second.payload, input.owned);
        expectUnownedSentinel(input);

        permittedSource = join(second.payload, 'tmp');
        allowRelocated = true;
        await expect(input.storage.release(true)).resolves.toBe(true);
        expect(existsSync(second.payload)).toBe(false);
        expect(existsSync(second.path)).toBe(false);
        expect(readdirSync(join(input.root, '.claims'))).toEqual([]);
        expectUnownedSentinel(input);

        await expect(input.storage.release(true)).resolves.toBe(true);
        expect(readdirSync(join(input.root, '.claims'))).toEqual([]);
        expectUnownedSentinel(input);
    });

    it('retains the same claim under fresh unknown and live fallback proofs until fresh dead proof', async () => {
        let currentState: ReturnType<StorageRecoveryPorts['sessionState']> = 'unknown';
        const observedPaths: Array<string | undefined> = [];
        const input = releaseFixture({
            identityState: () => 'alive',
            sessionState: (_owner, original, current) => {
                observedPaths.push(current);
                return current === original ? 'dead' : currentState;
            },
        });

        await expect(input.storage.release(true)).resolves.toBe(false);
        const claim = retainedClaim(input.root, input.token);
        const claimIdentity = fileIdentity(claim.path);
        const claimContents = readFileSync(claim.record, 'utf8');
        for (const state of ['unknown', 'alive'] as const) {
            currentState = state;
            await expect(input.storage.release(true)).resolves.toBe(false);
            expect(observedPaths.at(-1)).toBe(join(claim.payload, 'tmp'));
            expect(retainedClaim(input.root, input.token).path).toBe(claim.path);
            expect(fileIdentity(claim.path)).toEqual(claimIdentity);
            expect(readFileSync(claim.record, 'utf8')).toBe(claimContents);
            expectPayload(claim.payload, input.owned);
            expectUnownedSentinel(input);
        }

        currentState = 'dead';
        await expect(input.storage.release(true)).resolves.toBe(true);
        expect(existsSync(claim.payload)).toBe(false);
        expect(existsSync(claim.path)).toBe(false);
        expect(readdirSync(join(input.root, '.claims'))).toEqual([]);
        expectUnownedSentinel(input);
    });

    it.each([
        { target: 'reclaimer', timing: 'before release' },
        { target: 'run', timing: 'before release' },
        { target: 'payload', timing: 'before release' },
        { target: 'reclaimer', timing: 'during proof' },
        { target: 'run', timing: 'during proof' },
        { target: 'payload', timing: 'during proof' },
    ] as const)('preserves storage when $target ownership changes $timing', async ({ target, timing }) => {
        let allowRetained = false;
        let changeDuringProof: (() => void) | undefined;
        const input = releaseFixture({
            identityState: () => 'alive',
            sessionState: () => 'unknown',
            localReleaseAllowed: (_owner, original, current) => {
                if (current === original) {
                    return true;
                }
                changeDuringProof?.();
                changeDuringProof = undefined;
                return allowRetained;
            },
        });

        await expect(input.storage.release(true)).resolves.toBe(false);
        const claim = retainedClaim(input.root, input.token);
        const claimIdentity = fileIdentity(claim.path);
        let expectedClaimContents = readFileSync(claim.record, 'utf8');
        let expectedPayload = input.owned;
        const preservedPayload = join(input.root, 'preserved-original-payload');
        let changed = false;
        const changeOwnership = () => {
            if (target === 'payload') {
                renameSync(claim.payload, preservedPayload);
                mkdirSync(claim.payload);
                mkdirSync(join(claim.payload, 'tmp'));
                writeFileSync(join(claim.payload, 'tmp', 'owned-payload'), 'replacement storage payload');
                expectedPayload = payloadSnapshot(claim.payload);
            } else {
                const record: NonNullable<Parameters<typeof reclaimGuardStorage>[0]['sourceClaim']> =
                    JSON.parse(expectedClaimContents);
                if (target === 'reclaimer') {
                    record.reclaimer = { ...record.reclaimer, startedAt: 'changed-reclaimer' };
                } else {
                    record.run = {
                        ...record.run,
                        owner: { ...record.run.owner, startedAt: 'changed-run-owner' },
                    };
                }
                expectedClaimContents = `${JSON.stringify(record)}\n`;
                writeFileSync(claim.record, expectedClaimContents);
            }
            changed = true;
        };

        if (timing === 'during proof') {
            changeDuringProof = changeOwnership;
        } else {
            changeOwnership();
        }
        allowRetained = true;
        await expect(input.storage.release(true)).resolves.toBe(false);

        expect(changed).toBe(true);
        expect(retainedClaim(input.root, input.token).path).toBe(claim.path);
        expect(fileIdentity(claim.path)).toEqual(claimIdentity);
        expect(readFileSync(claim.record, 'utf8')).toBe(expectedClaimContents);
        expectPayload(claim.payload, expectedPayload);
        if (target === 'payload') {
            expect(expectedPayload.identity).not.toEqual(input.owned.identity);
            expect(expectedPayload.fileIdentity).not.toEqual(input.owned.fileIdentity);
            expectPayload(preservedPayload, input.owned);
        }
        expectUnownedSentinel(input);
    });
});
