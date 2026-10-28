import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../canonicalRecord.ts';
import { renderFindingLineage } from '../findingLineage.ts';
import { trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';

import {
    AUTHOR_BOT_COMMIT_EMAIL,
    AUTHOR_BOT_COMMIT_NAME,
    AUTHOR_BOT_NODE_ID,
    REQUIRED_REPOSITORY,
} from '../githubAppIdentity.ts';
import {
    laneStackPath,
    parseHistoricalAdmissionReceipt,
    readRegisteredLaneStack,
    writeLaneStack,
    type LaneStack,
} from '../stackedLanes.ts';
import {
    admitHistoricalStack,
    checkedNativeParentCompletion,
    nativeParentInspectionInvocation,
    historicalAdmissionShellPort,
    parseHistoricalStackObservation,
    parseSyncParentArgs,
    syncParentLane,
    type HistoricalAdmissionPort,
    type HistoricalAdmissionReceipt,
    type HistoricalStackObservation,
} from '../syncParentLane.ts';

const sha = (letter: string) => letter.repeat(40);
const anchor = 'acf91c9e72a98ce6c25f019593df8813c7a3c61d';
const child = '5844deb651f303617953c007d7d4cfd81622ce54';
const parent = '8770cb26cb4709e98553ee052d72a3aa5426262b';
const next = '2c5fdcd094be55a7a79638624260728546e61b25';
const childBranch = 'agent/4624/delivery-targets-draft';
const parentBranch = 'agent/4634/stream-export-output-draft';

function configWithForkMarkers(branch: string, ...markers: string[]): (args: string[]) => string {
    return () =>
        [
            `core.repositoryformatversion\n0`,
            ...markers.map((marker) => `branch.${branch}.sourdaw-stack-fork\n${marker}`),
        ]
            .join('\0')
            .concat('\0');
}

function reflog(entries: Array<[string, number]>): string {
    return entries
        .map(
            ([head, time], index) =>
                `${index === 0 ? '0'.repeat(40) : entries[index - 1]?.[0]} ${head} ${AUTHOR_BOT_COMMIT_NAME} <${AUTHOR_BOT_COMMIT_EMAIL}> ${time} +0200\t${index === 0 ? `branch: Created from ${head}` : 'commit: retained native history'}\n`
        )
        .join('');
}

function fixture() {
    let observation: HistoricalStackObservation = {
        child: {
            number: 5438,
            id: 'child-node',
            branch: childBranch,
            headSha: child,
            baseBranch: parentBranch,
            createdAt: '2026-10-21T22:39:53Z',
            repository: REQUIRED_REPOSITORY,
            repositoryId: 'repo-node',
            headRepository: REQUIRED_REPOSITORY,
            headRepositoryId: 'repo-node',
            authorId: AUTHOR_BOT_NODE_ID,
            state: 'OPEN',
            events: [],
        },
        parent: {
            number: 5425,
            id: 'parent-node',
            branch: parentBranch,
            headSha: parent,
            baseBranch: 'main',
            createdAt: '2026-10-21T21:09:21Z',
            repository: REQUIRED_REPOSITORY,
            repositoryId: 'repo-node',
            headRepository: REQUIRED_REPOSITORY,
            headRepositoryId: 'repo-node',
            authorId: AUTHOR_BOT_NODE_ID,
            state: 'OPEN',
            events: ['BaseRefChangedEvent'],
        },
        childPullRequests: [5438],
        parentPullRequests: [5425],
    };
    let stored: LaneStack | undefined;
    let receipt: HistoricalAdmissionReceipt | undefined;
    let markers: string[] = [];
    let head = child;
    let clean = true;
    let childLog = reflog([
        [anchor, 1792620751],
        [child, 1792723381],
    ]);
    let parentLog = reflog([
        [sha('e'), 1792614584],
        [anchor, 1792619550],
        [next, 1792621386],
    ]);
    const writes: string[] = [];
    const port: HistoricalAdmissionPort = {
        head: () => head,
        clean: () => clean,
        observe: () => structuredClone(observation),
        childLog: () => childLog,
        parentLog: () => parentLog,
        parentLocalHead: () => next,
        isAncestor: (a, b) =>
            a === b || ([anchor, sha('e'), next].includes(a) && [child, parent, next, anchor].includes(b)),
        readDescriptor: () => stored,
        readReceipt: () => receipt,
        markers: () => [...markers],
        saveReceipt: (value) => {
            writes.push('receipt');
            receipt = value;
        },
        addMarker: (value) => {
            writes.push('marker');
            markers.push(value);
        },
        installDescriptor: (value) => {
            writes.push('descriptor');
            stored = value;
        },
        readStack: () => undefined,
    };
    const input = { childPullRequest: 5438, parentPullRequest: 5425, expectedHead: child, branch: childBranch };
    return {
        port,
        input,
        writes,
        observation: () => observation,
        stored: () => stored,
        receipt: () => receipt,
        setObservation: (value: HistoricalStackObservation) => {
            observation = value;
        },
        setHead: (value: string) => {
            head = value;
        },
        setClean: (value: boolean) => {
            clean = value;
        },
        setChildLog: (value: string) => {
            childLog = value;
        },
        setParentLog: (value: string) => {
            parentLog = value;
        },
        setMarkers: (value: string[]) => {
            markers = value;
        },
        setDescriptor: (value: LaneStack | undefined) => {
            stored = value;
        },
        setReceipt: (value: HistoricalAdmissionReceipt | undefined) => {
            receipt = value;
        },
    };
}

function synchronizedProgressFixture() {
    const f = fixture();
    const original = admitHistoricalStack(f.input, f.port);
    const receipt = structuredClone(f.receipt());
    const progressed = sha('f');
    const ancestry = (a: string, b: string) =>
        f.port.isAncestor(a, b) ||
        (b === progressed && [anchor, sha('e'), next, parent].includes(a)) ||
        (a === progressed && b === child);
    const merges: string[] = [];
    const result = syncParentLane(original, {
        head: () => child,
        clean: () => true,
        main: () => sha('c'),
        parents: () => [
            {
                number: 5425,
                branch: parentBranch,
                headSha: progressed,
                state: 'OPEN',
                authorId: AUTHOR_BOT_NODE_ID,
                repository: REQUIRED_REPOSITORY,
            },
        ],
        isAncestor: ancestry,
        fetchParent: () => undefined,
        conflicts: () => [],
        save: (value) => f.setDescriptor(value),
        merge: (target) => {
            merges.push(target);
        },
    });
    f.setObservation({ ...f.observation(), parent: { ...f.observation().parent, headSha: progressed } });
    return { f, original, progressed, ancestry, merges, result, receipt };
}

function nativeLegacyFixture() {
    const fixtures = join(process.cwd(), '.agents', 'guard-storage-fixtures', 'historical-legacy');
    mkdirSync(fixtures, { recursive: true });
    const root = mkdtempSync(join(fixtures, 'native-'));
    const localEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    const git = (args: string[], time = 1792614000) =>
        execFileSync('git', args, {
            cwd: root,
            env: { ...localEnv, GIT_AUTHOR_DATE: `${time} +0000`, GIT_COMMITTER_DATE: `${time} +0000` },
            encoding: 'utf8',
            stdio: 'pipe',
        }).trim();
    git(['init', '--initial-branch=main']);
    git(['config', 'user.name', AUTHOR_BOT_COMMIT_NAME]);
    git(['config', 'user.email', AUTHOR_BOT_COMMIT_EMAIL]);
    git(['config', 'core.hooksPath', '/dev/null']);
    git(['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(root, '.git/info/exclude'), '.agents/\nsession/\n');
    git(['commit', '--allow-empty', '-m', 'initial']);
    git(['branch', parentBranch, git(['rev-parse', 'HEAD'])], 1792614584);
    git(['switch', parentBranch]);
    git(['commit', '--allow-empty', '-m', 'anchor'], 1792619550);
    const fork = git(['rev-parse', 'HEAD']);
    git(['branch', childBranch, fork], 1792620751);
    git(['commit', '--allow-empty', '-m', 'parent advance'], 1792621386);
    const parentHead = git(['rev-parse', 'HEAD']);
    git(['switch', childBranch]);
    git(['commit', '--allow-empty', '-m', 'child advance'], 1792723381);
    const head = git(['rev-parse', 'HEAD']);
    git(['config', '--add', `branch.${childBranch}.sourdaw-stack-fork`, fork]);
    const input = { ...fixture().input, expectedHead: head, legacyFork: fork };
    const observation = fixture().observation();
    observation.child.headSha = head;
    observation.parent.headSha = parentHead;
    const disk = historicalAdmissionShellPort(
        {
            lane: root,
            branch: childBranch,
            primaryRoot: root,
            gitPath: 'git',
            ghPath: 'unused-gh',
            session: { configDir: join(root, 'session'), env: {}, dispose: () => undefined },
            localEnv,
        },
        input
    );
    const childLog = () => readFileSync(join(root, '.git/logs/refs/heads', childBranch), 'utf8');
    const parentLog = () => readFileSync(join(root, '.git/logs/refs/heads', parentBranch), 'utf8');
    const port: HistoricalAdmissionPort = {
        ...disk,
        head: () => git(['rev-parse', 'HEAD']),
        clean: () => git(['status', '--porcelain=v1', '--untracked-files=all']) === '',
        observe: () => structuredClone(observation),
        childLog,
        parentLog,
        parentLocalHead: () => git(['rev-parse', `refs/heads/${parentBranch}`]),
        isAncestor: (ancestor, descendant) => {
            try {
                git(['merge-base', '--is-ancestor', ancestor, descendant]);
                return true;
            } catch {
                return false;
            }
        },
        addMarker: () => {
            throw new Error('legacy marker must never be written');
        },
    };
    const snapshot = () => ({
        config: readFileSync(join(root, '.git/config'), 'utf8'),
        head: port.head(),
        headRef: readFileSync(join(root, '.git/HEAD'), 'utf8'),
        headLog: readFileSync(join(root, '.git/logs/HEAD'), 'utf8'),
        childLog: childLog(),
        parentLog: parentLog(),
    });
    return { root, input, port, disk, snapshot };
}

function runNativeLogProbe(contents: string, scenario: string): void {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-native-log-read-'));
    const path = join(root, 'branch-log');
    writeFileSync(path, contents);
    // Native built-in bindings bypass Vitest module mocks. Isolate interposition in a Node process.
    const probe = `
        import fs from 'node:fs';
        import assert from 'node:assert/strict';
        import { syncBuiltinESMExports } from 'node:module';
        const path = process.argv[1];
        const byteLimit = 1024 * 1024;
        const original = { open: fs.openSync, read: fs.readSync, readFile: fs.readFileSync };
        let descriptor;
        let tracking = false;
        let bytesRead = 0;
        let beforePathRead = () => {};
        let afterOpen = () => {};
        let afterRead = () => {};
        fs.openSync = (...args) => {
            const opened = original.open(...args);
            if (tracking && args[0] === path && descriptor === undefined) {
                descriptor = opened;
                afterOpen();
            }
            return opened;
        };
        fs.readSync = (...args) => {
            const count = original.read(...args);
            if (tracking && args[0] === descriptor) {
                assert.ok(args[1].byteLength <= byteLimit + 1);
                bytesRead += count;
                afterRead();
            }
            return count;
        };
        fs.readFileSync = (...args) => {
            if (tracking && args[0] === path) beforePathRead();
            return original.readFile(...args);
        };
        syncBuiltinESMExports();
        const { historicalAdmissionShellPort } = await import(${JSON.stringify(pathToFileURL(join(process.cwd(), 'scripts/syncParentLane.ts')).href)});
        const port = historicalAdmissionShellPort({
            lane: ${JSON.stringify(root)},
            primaryRoot: ${JSON.stringify(root)},
            branch: ${JSON.stringify(childBranch)},
            gitPath: 'git', ghPath: 'gh', localEnv: {},
            session: { configDir: ${JSON.stringify(join(root, 'session'))}, env: {}, dispose: () => {} },
            capture: (_command, args) => {
                assert.deepEqual(args, ['rev-parse', '--path-format=absolute', '--git-path',
                    ${JSON.stringify(`logs/refs/heads/${childBranch}`)}]);
                return path;
            },
        }, { childPullRequest: 5438, parentPullRequest: 5425, expectedHead: ${JSON.stringify(child)} });
        const readLog = () => {
            tracking = true;
            try { return port.childLog(); } finally { tracking = false; }
        };
        const assertClosed = () => {
            assert.equal(typeof descriptor, 'number');
            assert.throws(() => fs.fstatSync(descriptor), { code: 'EBADF' });
        };
        ${scenario}
    `;
    execFileSync(process.execPath, ['--input-type=module', '--eval', probe, path], { stdio: 'pipe' });
}

describe('native historical reflog byte bound', () => {
    const byteLimit = 1024 * 1024;

    it('refuses a log growing beyond the bound between inspection and EOF', () => {
        runNativeLogProbe(
            reflog([[anchor, 1792620751]]),
            `
                const initialSize = fs.statSync(path).size;
                const grow = () => fs.appendFileSync(path, Buffer.alloc(byteLimit + 1 - initialSize, 'x'));
                beforePathRead = () => { beforePathRead = () => {}; grow(); };
                afterRead = () => { if (bytesRead === initialSize) grow(); };
                assert.throws(() => readLog(), /native branch history exceeds admission bound/);
                assert.equal(bytesRead, byteLimit + 1);
                assertClosed();
            `
        );
    });

    it.each([0, byteLimit - 1, byteLimit])('returns exactly %i bytes including multibyte UTF-8', (size) => {
        const contents = 'é'.repeat(Math.floor(size / 2)) + 'x'.repeat(size % 2);
        runNativeLogProbe(
            contents,
            `
                assert.equal(readLog(), original.readFile(path, 'utf8'));
                assert.equal(bytesRead, ${size});
                assertClosed();
            `
        );
    });

    it('refuses oversized multibyte input by bytes and closes the descriptor', () => {
        runNativeLogProbe(
            'é'.repeat(byteLimit / 2 + 1),
            `
                assert.throws(() => readLog(), /native branch history exceeds admission bound/);
                assert.equal(bytesRead, byteLimit + 1);
                assertClosed();
            `
        );
    });

    it('keeps one opened identity when its path is replaced and closes on success', () => {
        runNativeLogProbe(
            reflog([[anchor, 1792620751]]),
            `
                const contents = original.readFile(path, 'utf8');
                afterOpen = () => {
                    fs.renameSync(path, path + '.original');
                    fs.writeFileSync(path, Buffer.alloc(byteLimit + 1, 'x'));
                };
                assert.equal(readLog(), contents);
                assert.equal(original.readFile(path).byteLength, byteLimit + 1);
                assertClosed();
            `
        );
    });

    it('closes the descriptor when reading fails', () => {
        runNativeLogProbe(
            'unreadable native history',
            `
                afterRead = () => { throw new Error('native read failure'); };
                assert.throws(() => readLog(), /native read failure/);
                assertClosed();
            `
        );
    });

    it('fails closed for a missing native reflog', () => {
        runNativeLogProbe(
            '',
            `
                fs.renameSync(path, path + '.absent');
                assert.throws(() => readLog(), { code: 'ENOENT' });
            `
        );
    });
});

describe('historical stack native admission', () => {
    it('selects immutable author IDs only on concrete Actor types in the native query', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-historical-query-'));
        const queries: string[] = [];
        const port = historicalAdmissionShellPort(
            {
                lane: '/owned/child',
                branch: childBranch,
                primaryRoot: '/primary',
                gitPath: 'git',
                ghPath: 'gh',
                localEnv: {},
                session: { configDir: root, env: {}, dispose: () => undefined },
                capture: (command, args) => {
                    expect(command).toBe('gh');
                    expect(args.slice(0, 3)).toEqual(['api', 'graphql', '-f']);
                    queries.push(args[3] ?? '');
                    throw new Error('captured historical query');
                },
            },
            { childPullRequest: 5438, parentPullRequest: 5425, expectedHead: child }
        );

        expect(() => port.observe()).toThrow('captured historical query');
        expect(queries).toHaveLength(1);
        const query = queries[0] ?? '';
        expect(query).toContain('child:pullRequest(number:5438)');
        expect(query).toContain('parent:pullRequest(number:5425)');
        // Actor has no id field; identity must be selected on supported concrete Node types.
        const authors = Array.from(query.matchAll(/author\s*\{(.*?)\}\s*repository/g), (match) => match[1]?.trim());
        expect(authors).toEqual(['... on Bot { id } ... on User { id }', '... on Bot { id } ... on User { id }']);
    });

    it('replays when two matching resumes both observed the missing marker', () => {
        const f = fixture();
        const expected = admitHistoricalStack(f.input, f.port);
        const receipt = f.receipt();
        if (receipt === undefined) {
            throw new Error('fixture did not produce its receipt');
        }
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-concurrent-marker-'));
        execFileSync('git', ['init', root], { stdio: 'pipe' });
        const disk = historicalAdmissionShellPort(
            {
                lane: root,
                branch: childBranch,
                primaryRoot: root,
                gitPath: 'git',
                ghPath: 'gh',
                session: { configDir: join(root, 'session'), env: {}, dispose: () => undefined },
                localEnv: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
            },
            f.input
        );
        disk.saveReceipt(receipt);
        const firstRead = disk.markers();
        const secondRead = disk.markers();
        for (const observed of [firstRead, secondRead]) {
            if (observed.length === 0) {
                disk.addMarker(anchor);
            }
        }
        const port = {
            ...f.port,
            readReceipt: disk.readReceipt,
            readDescriptor: disk.readDescriptor,
            markers: disk.markers,
            saveReceipt: disk.saveReceipt,
            addMarker: disk.addMarker,
            installDescriptor: disk.installDescriptor,
        };
        let replay: LaneStack | undefined;
        let replayError: unknown;
        try {
            replay = admitHistoricalStack(f.input, port);
        } catch (error) {
            replayError = error;
        }
        let errorMessage: string | undefined;
        if (replayError instanceof Error) {
            errorMessage = replayError.message;
        }
        expect({ firstRead, secondRead, markers: disk.markers(), errorMessage }).toEqual({
            firstRead: [],
            secondRead: [],
            markers: [anchor],
            errorMessage: undefined,
        });
        expect(replayError).toBeUndefined();
        expect(replay).toEqual(expected);
        expect(disk.readDescriptor()).toEqual(expected);
        expect(disk.readReceipt()).toEqual(receipt);
    });

    it.each([
        { kind: 'foreign only', values: [sha('d')] },
        { kind: 'matching and foreign', values: [anchor, sha('d')] },
    ])('preserves $kind marker values and refuses conflicting resumption', ({ values }) => {
        const f = fixture();
        admitHistoricalStack(f.input, f.port);
        const receipt = f.receipt();
        if (receipt === undefined) {
            throw new Error('fixture did not produce its receipt');
        }
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-foreign-marker-'));
        execFileSync('git', ['init', root], { stdio: 'pipe' });
        const localEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
        const disk = historicalAdmissionShellPort(
            {
                lane: root,
                branch: childBranch,
                primaryRoot: root,
                gitPath: 'git',
                ghPath: 'gh',
                session: { configDir: join(root, 'session'), env: {}, dispose: () => undefined },
                localEnv,
            },
            f.input
        );
        disk.saveReceipt(receipt);
        for (const value of values) {
            execFileSync('git', ['config', '--add', `branch.${childBranch}.sourdaw-stack-fork`, value], {
                cwd: root,
                env: localEnv,
            });
        }
        disk.addMarker(anchor);
        const expected = [...values];
        if (!values.includes(anchor)) {
            expected.push(anchor);
        }
        expect(disk.markers()).toEqual(expected);
        const port = {
            ...f.port,
            readReceipt: disk.readReceipt,
            readDescriptor: disk.readDescriptor,
            markers: disk.markers,
            saveReceipt: disk.saveReceipt,
            addMarker: disk.addMarker,
            installDescriptor: disk.installDescriptor,
        };
        expect(() => admitHistoricalStack(f.input, port)).toThrow(/conflicting/);
        expect(disk.markers()).toEqual(expected);
        expect(disk.readDescriptor()).toBeUndefined();
        expect(disk.readReceipt()).toEqual(receipt);
    });

    it('replays admission after a no-op native sync advances only the stored parent head', () => {
        const { f, original, progressed, ancestry, merges, result, receipt } = synchronizedProgressFixture();
        expect(result).toBe(child);
        expect(merges).toEqual([]);
        expect(f.stored()).toEqual({ ...original, parentHead: progressed });
        const writes = [...f.writes];
        expect(admitHistoricalStack(f.input, { ...f.port, isAncestor: ancestry })).toEqual(original);
        expect(f.port.head()).toBe(child);
        expect(f.stored()).toEqual({ ...original, parentHead: progressed });
        expect(f.receipt()).toEqual(receipt);
        expect(f.writes).toEqual(writes);
    });

    it.each([
        'backwards head',
        'unrelated head',
        'head beyond verified parent',
        'progress absent from child',
        'wrong fork',
        'wrong parent',
        'wrong parent PR',
        'wrong marker',
        'cycle',
    ])('refuses %s after native descriptor progress', (change) => {
        const { f, original, progressed, ancestry } = synchronizedProgressFixture();
        const stored = f.stored();
        if (stored === undefined) {
            throw new Error('native sync did not save progress');
        }
        let port = { ...f.port, isAncestor: ancestry };
        if (change === 'backwards head') {
            f.setDescriptor({ ...stored, parentHead: anchor });
        }
        if (change === 'unrelated head') {
            f.setDescriptor({ ...stored, parentHead: sha('d') });
        }
        if (change === 'head beyond verified parent') {
            f.setDescriptor({ ...stored, parentHead: sha('d') });
            port = {
                ...port,
                isAncestor: (a, b) =>
                    ancestry(a, b) || (a === parent && b === sha('d')) || (a === sha('d') && b === child),
            };
        }
        if (change === 'progress absent from child') {
            port = { ...port, isAncestor: (a, b) => !(a === progressed && b === child) && ancestry(a, b) };
        }
        if (change === 'wrong fork') {
            f.setDescriptor({ ...stored, forkHead: sha('d') });
        }
        if (change === 'wrong parent') {
            f.setDescriptor({ ...stored, parentBranch: 'agent/other' });
        }
        if (change === 'wrong parent PR') {
            f.setDescriptor({ ...stored, parentPullRequest: 9999 });
        }
        if (change === 'wrong marker') {
            f.setMarkers([sha('d')]);
        }
        if (change === 'cycle') {
            port = {
                ...port,
                readStack: () => ({ ...original, childBranch: parentBranch, parentBranch: childBranch }),
            };
        }
        const writes = [...f.writes];
        expect(() => admitHistoricalStack(f.input, port)).toThrow();
        expect(f.writes).toEqual(writes);
    });

    it.each([
        { record: 'receipt', phase: 2 },
        { record: 'receipt', phase: 3 },
        { record: 'receipt', phase: 4 },
        { record: 'marker', phase: 2 },
        { record: 'marker', phase: 3 },
        { record: 'marker', phase: 4 },
        { record: 'descriptor', phase: 2 },
        { record: 'descriptor', phase: 3 },
        { record: 'descriptor', phase: 4 },
    ])('refuses $record movement before mutation boundary $phase', ({ record, phase }) => {
        const f = fixture();
        let observations = 0;
        const descriptor: LaneStack = {
            version: 1,
            childBranch,
            parentBranch,
            forkHead: anchor,
            parentHead: parent,
            parentPullRequest: 5425,
        };
        const port = {
            ...f.port,
            observe: () => {
                observations += 1;
                if (observations === phase) {
                    if (record === 'receipt') {
                        f.setReceipt({ version: 1, childPullRequest: 5438, expectedChildHead: sha('d'), descriptor });
                    }
                    if (record === 'marker') {
                        let marker = anchor;
                        if (phase === 4) {
                            marker = sha('d');
                        }
                        f.setMarkers([marker]);
                    }
                    if (record === 'descriptor') {
                        f.setDescriptor(descriptor);
                    }
                }
                return f.port.observe();
            },
        };
        expect(() => admitHistoricalStack(f.input, port)).toThrow(/changed/);
        const writes: string[] = [];
        if (phase > 2) {
            writes.push('receipt');
        }
        if (phase > 3) {
            writes.push('marker');
        }
        expect(f.writes).toEqual(writes);
    });

    it('refuses a descriptor changed after the advanced replay snapshot without overwriting it', () => {
        const { f, original, ancestry } = synchronizedProgressFixture();
        let observations = 0;
        const writes = [...f.writes];
        const port = {
            ...f.port,
            isAncestor: ancestry,
            observe: () => {
                observations += 1;
                if (observations === 2) {
                    f.setDescriptor(original);
                }
                return f.port.observe();
            },
        };
        expect(() => admitHistoricalStack(f.input, port)).toThrow(/changed/);
        expect(f.stored()).toEqual(original);
        expect(f.writes).toEqual(writes);
    });

    it('installs records exclusively and reads every real Git marker value without sharing another checkout', () => {
        const f = fixture();
        const stack = admitHistoricalStack(f.input, f.port);
        const receipt = f.receipt();
        expect(receipt).toBeDefined();
        if (receipt === undefined) {
            throw new Error('fixture did not admit');
        }
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-native-admission-adapter-'));
        execFileSync('git', ['init', root], { stdio: 'pipe' });
        const port = historicalAdmissionShellPort(
            {
                lane: root,
                branch: childBranch,
                primaryRoot: root,
                gitPath: 'git',
                ghPath: 'gh',
                session: { configDir: join(root, 'session'), env: {}, dispose: () => undefined },
                localEnv: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
            },
            f.input
        );
        expect(port.markers()).toEqual([]);
        port.saveReceipt(receipt);
        expect(() => port.readStack(childBranch)).toThrow(/historical admission/);
        port.addMarker(anchor);
        expect(port.markers()).toEqual([anchor]);
        port.installDescriptor(stack);
        port.installDescriptor(stack);
        expect(port.readStack(childBranch)).toEqual(stack);
        expect(() => port.installDescriptor({ ...stack, parentPullRequest: 9999 })).toThrow();
        expect(port.readDescriptor()).toEqual(stack);
        port.addMarker(anchor);
        expect(port.markers()).toEqual([anchor]);
        execFileSync('git', ['config', '--add', `branch.${childBranch}.sourdaw-stack-fork`, anchor], {
            cwd: root,
            env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
        });
        expect(port.markers()).toEqual([anchor, anchor]);
        expect(() => port.addMarker(anchor)).toThrow();
        expect(port.markers()).toEqual([anchor, anchor]);
    });

    it.each([
        { order: 'foreign then matching', markers: [sha('d'), anchor] },
        { order: 'matching then foreign', markers: [anchor, sha('d')] },
        { order: 'duplicate matching', markers: [anchor, anchor] },
    ])('ordinary registered-lineage reads refuse $order real Git markers', ({ markers }) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-registered-marker-read-'));
        execFileSync('git', ['init', root], { stdio: 'pipe' });
        const localEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
        const descriptor: LaneStack = {
            version: 1,
            childBranch,
            parentBranch,
            forkHead: anchor,
            parentHead: next,
            parentPullRequest: 5425,
        };
        const port = historicalAdmissionShellPort(
            {
                lane: root,
                branch: childBranch,
                primaryRoot: root,
                gitPath: 'git',
                ghPath: 'gh',
                session: { configDir: join(root, 'session'), env: {}, dispose: () => undefined },
                localEnv,
            },
            { childPullRequest: 5438, parentPullRequest: 5425, expectedHead: child }
        );
        port.saveReceipt({ version: 1, childPullRequest: 5438, expectedChildHead: child, descriptor });
        port.installDescriptor(descriptor);
        for (const marker of markers) {
            execFileSync('git', ['config', '--add', `branch.${childBranch}.sourdaw-stack-fork`, marker], {
                cwd: root,
                env: localEnv,
            });
        }

        expect(() => port.readStack(childBranch)).toThrow(/lineage marker/);
    });

    it('requires explicit exact-head admission arguments and preserves ordinary sync selection', () => {
        const args = [
            '--lane',
            '/owned/child',
            '--admit-historical',
            '--child-pr',
            '5438',
            '--parent-pr',
            '5425',
            '--expected-head',
            child,
        ];
        expect(parseSyncParentArgs(['--lane', '/owned/child'])).toEqual({ lane: '/owned/child' });
        expect(parseSyncParentArgs(args).admission?.expectedHead).toBe(child);
        expect(parseSyncParentArgs([...args, '--legacy-fork', anchor]).admission).toEqual({
            childPullRequest: 5438,
            parentPullRequest: 5425,
            expectedHead: child,
            legacyFork: anchor,
        });
        for (const invalid of [
            args.slice(0, -2),
            [...args, '--force'],
            args.map((v) => (v === '5425' ? '5438' : v)),
            args.map((v) => (v === child ? 'HEAD' : v)),
            [...args, '--legacy-fork'],
            [...args, '--legacy-fork', 'HEAD'],
            [...args, '--legacy-fork', anchor.toUpperCase()],
            [...args, '--legacy-fork', anchor, '--legacy-fork', anchor],
            ['--lane', '/owned/child', '--legacy-fork', anchor],
            [...args.slice(0, 2), '--legacy-fork', anchor, ...args.slice(2)],
        ]) {
            expect(() => parseSyncParentArgs(invalid)).toThrow(/usage/);
        }
    });

    it('uses the admitted immutable identity in normal subsequent synchronization', () => {
        const f = fixture();
        const descriptor = admitHistoricalStack(f.input, f.port);
        let head = child;
        const targets: string[] = [];
        const merged = sha('a');
        const result = syncParentLane(descriptor, {
            head: () => head,
            clean: () => true,
            main: () => sha('c'),
            parents: () => [
                {
                    number: 5425,
                    branch: parentBranch,
                    headSha: parent,
                    state: 'OPEN',
                    authorId: AUTHOR_BOT_NODE_ID,
                    repository: REQUIRED_REPOSITORY,
                },
            ],
            isAncestor: (a, b) => a === b || a === anchor || b === merged,
            fetchParent: () => undefined,
            conflicts: () => [],
            save: () => undefined,
            merge: (target) => {
                targets.push(target);
                head = merged;
            },
        });
        expect(targets).toEqual([parent]);
        expect(result).toBe(merged);
    });

    it('requires complete parsed remote connections, live refs and unique all-history parent and child identities', () => {
        const f = fixture();
        const remotePr = (pr: HistoricalStackObservation['child']) => ({
            id: pr.id,
            number: pr.number,
            createdAt: pr.createdAt,
            state: pr.state,
            author: { id: pr.authorId },
            repository: { id: pr.repositoryId, nameWithOwner: pr.repository },
            headRepository: { id: pr.headRepositoryId, nameWithOwner: pr.headRepository },
            headRefName: pr.branch,
            headRefOid: pr.headSha,
            headRef: { name: pr.branch, target: { oid: pr.headSha } },
            baseRefName: pr.baseBranch,
            baseRef: { name: pr.baseBranch, target: { oid: parent } },
            timelineItems: {
                pageInfo: { hasNextPage: false },
                nodes: pr.events.map((event) => ({ __typename: event })),
            },
        });
        const core = { child: remotePr(f.observation().child), parent: remotePr(f.observation().parent) };
        const candidate = (pr: HistoricalStackObservation['child']) => ({
            number: pr.number,
            branch: pr.branch,
            headSha: pr.headSha,
            state: 'OPEN' as const,
            repository: pr.repository,
            authorId: pr.authorId,
        });
        const children = [candidate(f.observation().child)];
        const parents = [candidate(f.observation().parent)];
        const raw = (value: unknown) => JSON.stringify({ data: { repository: value } });
        expect(parseHistoricalStackObservation(raw(core), children, parents)).toEqual(f.observation());
        const truncated = structuredClone(core);
        truncated.child.timelineItems.pageInfo.hasNextPage = true;
        expect(() => parseHistoricalStackObservation(raw(truncated), children, parents)).toThrow(/incomplete/);
        expect(() =>
            parseHistoricalStackObservation(raw(core), children, [
                ...parents,
                { ...candidate(f.observation().parent), number: 9999 },
            ])
        ).toThrow(/exactly one/);
        expect(() => parseHistoricalStackObservation(raw(core), [...children, ...children], parents)).toThrow(
            /exactly one/
        );
        const moved = structuredClone(core);
        moved.parent.headRef.target.oid = sha('f');
        expect(() => parseHistoricalStackObservation(raw(moved), children, parents)).toThrow(/changed/);
        const baseMoved = structuredClone(core);
        baseMoved.child.baseRef.target.oid = sha('f');
        expect(() => parseHistoricalStackObservation(raw(baseMoved), children, parents)).toThrow(/changed/);
        expect(() =>
            parseHistoricalStackObservation(
                JSON.stringify({ errors: [], data: { repository: core } }),
                children,
                parents
            )
        ).toThrow(/errors/);
        for (const author of [null, {}, { login: 'hplovecraft208' }, { id: '' }]) {
            expect(() =>
                parseHistoricalStackObservation(raw({ ...core, child: { ...core.child, author } }), children, parents)
            ).toThrow(/historical/);
            expect(() =>
                parseHistoricalStackObservation(raw({ ...core, parent: { ...core.parent, author } }), children, parents)
            ).toThrow(/historical/);
        }
    });
    it('blocks every normal registered-lineage reader during a receipt-only crash and accepts only matching completion', () => {
        const f = fixture();
        const stack = admitHistoricalStack(f.input, f.port);
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-historical-admission-'));
        writeLaneStack(root, stack);
        const path = laneStackPath(root, childBranch);
        const raw = readFileSync(path, 'utf8');
        // A separate branch namespace with only the admission receipt models the pre-marker crash.
        const pending = { ...stack, childBranch: 'agent/pending' };
        writeFileSync(
            `${laneStackPath(root, pending.childBranch)}.admission.json`,
            JSON.stringify({ ...f.receipt(), descriptor: pending })
        );
        expect(() =>
            readRegisteredLaneStack(root, pending.childBranch, configWithForkMarkers(pending.childBranch))
        ).toThrow(/historical admission/);
        writeFileSync(`${path}.admission.json`, JSON.stringify(f.receipt()));
        expect(readRegisteredLaneStack(root, childBranch, configWithForkMarkers(childBranch, anchor))).toEqual(stack);
        writeLaneStack(root, { ...stack, parentHead: sha('f') });
        expect(readRegisteredLaneStack(root, childBranch, configWithForkMarkers(childBranch, anchor))?.parentHead).toBe(
            sha('f')
        );
        writeFileSync(path, JSON.stringify({ ...stack, parentPullRequest: 9999 }));
        expect(() => readRegisteredLaneStack(root, childBranch, configWithForkMarkers(childBranch, anchor))).toThrow(
            /historical admission/
        );
        writeFileSync(path, raw);
    });
    it('binds the actual 5438 creation anchor to the original unique named parent and replays without writes', () => {
        const f = fixture();
        const result = admitHistoricalStack(f.input, f.port);
        expect(result).toEqual({
            version: 1,
            childBranch,
            parentBranch,
            forkHead: anchor,
            parentHead: parent,
            parentPullRequest: 5425,
        });
        expect(f.writes).toEqual(['receipt', 'marker', 'descriptor']);
        expect(admitHistoricalStack(f.input, f.port)).toEqual(result);
        expect(f.writes).toEqual(['receipt', 'marker', 'descriptor']);
    });

    it('admits only an explicitly named existing sole legacy marker and never writes that marker', () => {
        const f = fixture();
        f.setMarkers([anchor]);
        expect(() => admitHistoricalStack(f.input, f.port)).toThrow('unjournaled partial');
        expect(f.writes).toEqual([]);
        const input = { ...f.input, legacyFork: anchor };
        const result = admitHistoricalStack(input, f.port);
        expect(result.forkHead).toBe(anchor);
        expect(f.writes).toEqual(['receipt', 'descriptor']);
        expect(f.receipt()).toEqual({
            version: 1,
            childPullRequest: input.childPullRequest,
            expectedChildHead: child,
            descriptor: result,
        });
        expect(admitHistoricalStack(input, f.port)).toEqual(result);
        expect(f.writes).toEqual(['receipt', 'descriptor']);
        expect(f.port.markers()).toEqual([anchor]);
    });

    it.each([
        { name: 'missing', markers: [] },
        { name: 'foreign', markers: [sha('d')] },
        { name: 'duplicate', markers: [anchor, anchor] },
        { name: 'contradictory', markers: [anchor, sha('d')] },
    ])('refuses $name legacy markers before writing', ({ markers }) => {
        const f = fixture();
        f.setMarkers(markers);
        expect(() => admitHistoricalStack({ ...f.input, legacyFork: anchor }, f.port)).toThrow(/legacy fork/);
        expect(f.writes).toEqual([]);
        expect(f.port.markers()).toEqual(markers);
    });

    it.each(['HEAD', anchor.toUpperCase(), sha('d')])(
        'refuses a legacy fork flag %s differing from proven birth',
        (legacyFork) => {
            const f = fixture();
            f.setMarkers([anchor]);
            expect(() => admitHistoricalStack({ ...f.input, legacyFork }, f.port)).toThrow(/legacy fork/);
            expect(f.writes).toEqual([]);
        }
    );

    it.each(['unjournaled descriptor', 'corrupt receipt', 'conflicting receipt', 'conflicting descriptor'])(
        'never adopts %s under legacy opt-in',
        (kind) => {
            const f = fixture();
            const admitted = admitHistoricalStack(f.input, f.port);
            if (kind === 'unjournaled descriptor') {
                f.setReceipt(undefined);
            }
            if (kind === 'corrupt receipt') {
                const receipt = f.receipt();
                if (receipt === undefined) {
                    throw new Error('missing fixture receipt');
                }
                f.setReceipt({ ...receipt, childPullRequest: 0 });
            }
            if (kind === 'conflicting receipt') {
                const receipt = f.receipt();
                if (receipt === undefined) {
                    throw new Error('missing fixture receipt');
                }
                f.setReceipt({ ...receipt, expectedChildHead: sha('d') });
            }
            if (kind === 'conflicting descriptor') {
                f.setDescriptor({ ...admitted, parentPullRequest: 9999 });
            }
            const writes = [...f.writes];
            expect(() => admitHistoricalStack({ ...f.input, legacyFork: anchor }, f.port)).toThrow();
            expect(f.writes).toEqual(writes);
        }
    );

    it.each(['receipt retained', 'descriptor installed'])('validates the legacy flag on %s replay', (phase) => {
        const f = fixture();
        f.setMarkers([anchor]);
        const input = { ...f.input, legacyFork: anchor };
        if (phase === 'receipt retained') {
            expect(() =>
                admitHistoricalStack(input, {
                    ...f.port,
                    installDescriptor: () => {
                        throw new Error('interrupted');
                    },
                })
            ).toThrow('interrupted');
            expect(f.receipt()).toBeDefined();
            expect(f.stored()).toBeUndefined();
        } else {
            admitHistoricalStack(input, f.port);
        }
        const writes = [...f.writes];
        expect(() => admitHistoricalStack({ ...input, legacyFork: sha('d') }, f.port)).toThrow(/legacy fork/);
        expect(f.writes).toEqual(writes);
        f.setMarkers([]);
        expect(() => admitHistoricalStack(input, f.port)).toThrow(/legacy fork/);
        expect(f.writes).toEqual(writes);
        f.setMarkers([anchor]);
        expect(admitHistoricalStack(input, f.port).forkHead).toBe(anchor);
        expect(f.port.markers()).toEqual([anchor]);
    });

    it.each(['complete', 'receipt interruption', 'descriptor interruption'])(
        'preserves real Git config, head and full native histories through %s and replay',
        (phase) => {
            const { root, input, port, snapshot } = nativeLegacyFixture();
            const before = snapshot();
            expect(before.childLog.startsWith(`${'0'.repeat(40)} ${input.legacyFork} `)).toBe(true);
            expect(port.markers()).toEqual([input.legacyFork]);
            expect(() => port.readStack(childBranch)).toThrow(/descriptor missing/);
            if (phase !== 'complete') {
                expect(() =>
                    admitHistoricalStack(input, {
                        ...port,
                        installDescriptor: (descriptor) => {
                            if (phase === 'descriptor interruption') {
                                port.installDescriptor(descriptor);
                            }
                            throw new Error('interrupted');
                        },
                    })
                ).toThrow('interrupted');
                expect(port.readReceipt()).toBeDefined();
                if (phase === 'receipt interruption') {
                    expect(port.readDescriptor()).toBeUndefined();
                    expect(() => port.readStack(childBranch)).toThrow(/historical admission/);
                }
                expect(snapshot()).toEqual(before);
            }
            const result = admitHistoricalStack(input, port);
            const descriptorPath = laneStackPath(root, childBranch);
            const receiptPath = `${descriptorPath}.admission.json`;
            const receiptBytes = readFileSync(receiptPath, 'utf8');
            const descriptorBytes = readFileSync(descriptorPath, 'utf8');
            expect(port.readStack(childBranch)).toEqual(result);
            expect(port.readReceipt()).toEqual({
                version: 1,
                childPullRequest: input.childPullRequest,
                expectedChildHead: input.expectedHead,
                descriptor: result,
            });
            expect(admitHistoricalStack(input, port)).toEqual(result);
            expect(readFileSync(receiptPath, 'utf8')).toBe(receiptBytes);
            expect(readFileSync(descriptorPath, 'utf8')).toBe(descriptorBytes);
            expect(port.markers()).toEqual([input.legacyFork]);
            expect(snapshot()).toEqual(before);
        }
    );

    it.each(['receipt', 'descriptor'])(
        'retains a conflicting real exclusive %s winner without overwriting it',
        (record) => {
            const { input, port, disk, snapshot } = nativeLegacyFixture();
            const before = snapshot();
            const racingPort = {
                ...port,
                saveReceipt: (receipt: HistoricalAdmissionReceipt) => {
                    if (record === 'receipt') {
                        disk.saveReceipt({ ...receipt, expectedChildHead: sha('d') });
                    }
                    disk.saveReceipt(receipt);
                },
                installDescriptor: (descriptor: LaneStack) => {
                    disk.installDescriptor({ ...descriptor, parentPullRequest: 9999 });
                    disk.installDescriptor(descriptor);
                },
            };
            expect(() => admitHistoricalStack(input, racingPort)).toThrow();
            if (record === 'receipt') {
                expect(disk.readReceipt()?.expectedChildHead).toBe(sha('d'));
                expect(disk.readDescriptor()).toBeUndefined();
            } else {
                expect(disk.readDescriptor()?.parentPullRequest).toBe(9999);
            }
            expect(() => admitHistoricalStack(input, port)).toThrow();
            expect(snapshot()).toEqual(before);
        }
    );

    it.each(['parent', 'head', 'marker', 'receipt', 'descriptor'])(
        'refuses legacy %s movement while retaining its newly written receipt',
        (change) => {
            const f = fixture();
            f.setMarkers([anchor]);
            const input = { ...f.input, legacyFork: anchor };
            expect(() =>
                admitHistoricalStack(input, {
                    ...f.port,
                    saveReceipt: (receipt) => {
                        f.port.saveReceipt(receipt);
                        if (change === 'parent') {
                            f.observation().parent.headSha = sha('d');
                        }
                        if (change === 'head') {
                            f.setHead(sha('d'));
                        }
                        if (change === 'marker') {
                            f.setMarkers([]);
                        }
                        if (change === 'receipt') {
                            f.setReceipt({ ...receipt, expectedChildHead: sha('d') });
                        }
                        if (change === 'descriptor') {
                            f.setDescriptor(receipt.descriptor);
                        }
                    },
                })
            ).toThrow(/changed/);
            expect(f.writes).toEqual(['receipt']);
            expect(f.receipt()).toBeDefined();
        }
    );

    it.each(['parent', 'head', 'native history', 'marker'])(
        'refuses legacy %s movement during descriptor installation and retains the journal',
        (change) => {
            const f = fixture();
            f.setMarkers([anchor]);
            expect(() =>
                admitHistoricalStack(
                    { ...f.input, legacyFork: anchor },
                    {
                        ...f.port,
                        installDescriptor: (descriptor) => {
                            f.port.installDescriptor(descriptor);
                            if (change === 'parent') {
                                f.observation().parent.headSha = sha('d');
                            }
                            if (change === 'head') {
                                f.setHead(sha('d'));
                            }
                            if (change === 'native history') {
                                f.setChildLog('changed');
                            }
                            if (change === 'marker') {
                                f.setMarkers([sha('d')]);
                            }
                        },
                    }
                )
            ).toThrow(/changed|installation failed/);
            expect(f.writes).toEqual(['receipt', 'descriptor']);
            expect(f.receipt()).toBeDefined();
            expect(f.stored()).toBeDefined();
        }
    );

    it('uses the actual 5447 temporal anchor rather than its later cached base or merge-base', () => {
        const f = fixture();
        const fork = '9e6179d26ae464a402c520d8ddea5828cd2c72a5';
        const tip = 'cf5baf44db738618fe18a0a123495bbeab0ba473';
        const after = 'dc60c60bc3906a1cd3daefcea84178e32098e93a';
        const grandchildBranch = 'agent/4664/wav-output-reports-draft';
        f.setObservation({
            child: {
                ...f.observation().child,
                id: 'grandchild-node',
                number: 5447,
                branch: grandchildBranch,
                headSha: tip,
                baseBranch: childBranch,
                createdAt: '2026-10-21T23:49:27Z',
            },
            parent: { ...f.observation().child, baseBranch: parentBranch, events: [] },
            childPullRequests: [5447],
            parentPullRequests: [5438],
        });
        f.setHead(tip);
        f.setChildLog(
            reflog([
                [fork, 1792625930],
                [tip, 1792648850],
            ])
        );
        f.setParentLog(
            reflog([
                [anchor, 1792620751],
                [fork, 1792625342],
                [after, 1792630352],
            ])
        );
        const result = admitHistoricalStack(
            { childPullRequest: 5447, parentPullRequest: 5438, expectedHead: tip, branch: grandchildBranch },
            { ...f.port, parentLocalHead: () => after, isAncestor: () => true }
        );
        expect(result.forkHead).toBe(fork);
        expect(result.parentPullRequest).toBe(5438);
    });

    it.each(
        [
            'moved child',
            'wrong child ref',
            'foreign child',
            'wrong repository',
            'retargeted child',
            'reused parent',
            'replacement parent',
            'deleted parent',
            'force pushed parent',
            'late parent',
            'dirty child',
        ].flatMap((change) => [
            { change, mode: 'ordinary', legacyFork: undefined },
            { change, mode: 'legacy', legacyFork: anchor },
        ])
    )('refuses $change before any $mode record write', ({ change, legacyFork }) => {
        const f = fixture();
        if (legacyFork !== undefined) {
            f.setMarkers([legacyFork]);
        }
        const remote = f.observation();
        if (change === 'moved child') {
            f.setHead(sha('b'));
        }
        if (change === 'wrong child ref') {
            remote.child.branch = 'agent/other';
        }
        if (change === 'foreign child') {
            remote.child.authorId = 'foreign';
        }
        if (change === 'wrong repository') {
            remote.parent.headRepositoryId = 'other-repository';
        }
        if (change === 'retargeted child') {
            remote.child.events.push('BaseRefChangedEvent');
        }
        if (change === 'reused parent') {
            remote.parentPullRequests.push(9999);
        }
        if (change === 'replacement parent') {
            remote.parent.number = 9999;
        }
        if (change === 'deleted parent') {
            remote.parent.events.push('HeadRefDeletedEvent');
        }
        if (change === 'force pushed parent') {
            remote.parent.events.push('HeadRefForcePushedEvent');
        }
        if (change === 'late parent') {
            remote.parent.createdAt = '2026-10-21T22:20:00Z';
        }
        if (change === 'dirty child') {
            f.setClean(false);
        }
        f.setObservation(remote);
        expect(() => admitHistoricalStack({ ...f.input, legacyFork }, f.port)).toThrow();
        expect(f.writes).toEqual([]);
    });

    it.each(
        [
            'missing birth',
            'wrong actor',
            'ambiguous time',
            'parent at another commit',
            'discontinuous log',
            'rewritten log',
            'unrelated history',
        ].flatMap((change) => [
            { change, mode: 'ordinary', legacyFork: undefined },
            { change, mode: 'legacy', legacyFork: anchor },
        ])
    )('refuses $change as a $mode historical creation witness', ({ change, legacyFork }) => {
        const f = fixture();
        if (legacyFork !== undefined) {
            f.setMarkers([legacyFork]);
        }
        if (change === 'missing birth') {
            f.setChildLog(
                reflog([
                    [anchor, 1792620751],
                    [child, 1792723381],
                ])
                    .split('\n')
                    .slice(1)
                    .join('\n')
            );
        }
        if (change === 'wrong actor') {
            f.setChildLog(
                reflog([
                    [anchor, 1792620751],
                    [child, 1792723381],
                ]).replace(AUTHOR_BOT_COMMIT_EMAIL, 'foreign@example.test')
            );
        }
        if (change === 'ambiguous time') {
            f.setParentLog(
                reflog([
                    [sha('e'), 1792614584],
                    [anchor, 1792620751],
                    [next, 1792621386],
                ])
            );
        }
        if (change === 'parent at another commit') {
            f.setParentLog(
                reflog([
                    [sha('e'), 1792614584],
                    [sha('f'), 1792619550],
                    [next, 1792621386],
                ])
            );
        }
        if (change === 'discontinuous log') {
            f.setChildLog(
                reflog([
                    [anchor, 1792620751],
                    [child, 1792723381],
                ]).replace(`${anchor} ${child}`, `${sha('d')} ${child}`)
            );
        }
        if (change === 'rewritten log') {
            f.setChildLog(
                reflog([
                    [anchor, 1792620751],
                    [child, 1792723381],
                ]).replace('commit: retained native history', 'reset: moving to another branch')
            );
        }
        let port: HistoricalAdmissionPort = f.port;
        if (change === 'unrelated history') {
            port = { ...f.port, isAncestor: () => false };
        }
        if (change === 'parent at another commit') {
            const order = [anchor, sha('e'), sha('f'), next, parent, child];
            port = {
                ...f.port,
                isAncestor: (a, b) => {
                    const first = order.indexOf(a);
                    return first >= 0 && order.indexOf(b) >= first;
                },
            };
        }
        expect(() => admitHistoricalStack({ ...f.input, legacyFork }, port)).toThrow();
        expect(f.writes).toEqual([]);
    });

    it('refuses cycles and partial/conflicting records instead of adopting them', () => {
        for (const kind of ['cycle', 'marker only', 'descriptor only', 'duplicate marker', 'foreign descriptor']) {
            const f = fixture();
            if (kind.includes('marker')) {
                if (kind === 'duplicate marker') {
                    f.setMarkers([anchor, anchor]);
                } else {
                    f.setMarkers([anchor]);
                }
            }
            if (kind.includes('descriptor')) {
                f.setDescriptor({
                    version: 1,
                    childBranch,
                    parentBranch: 'agent/other',
                    forkHead: anchor,
                    parentHead: parent,
                });
            }
            let port: HistoricalAdmissionPort = f.port;
            if (kind === 'cycle') {
                port = {
                    ...f.port,
                    readStack: () => ({
                        version: 1,
                        childBranch: parentBranch,
                        parentBranch: childBranch,
                        forkHead: anchor,
                        parentHead: parent,
                    }),
                };
            }
            expect(() => admitHistoricalStack(f.input, port)).toThrow();
            expect(f.writes).toEqual([]);
        }
    });

    it('refuses a legacy cycle before journaling the proven marker', () => {
        const f = fixture();
        f.setMarkers([anchor]);
        expect(() =>
            admitHistoricalStack(
                { ...f.input, legacyFork: anchor },
                {
                    ...f.port,
                    readStack: () => ({
                        version: 1,
                        childBranch: parentBranch,
                        parentBranch: childBranch,
                        forkHead: anchor,
                        parentHead: parent,
                    }),
                }
            )
        ).toThrow(/cycle/);
        expect(f.writes).toEqual([]);
        expect(f.port.markers()).toEqual([anchor]);
    });

    it('retains an unusable marker-only crash and safely resumes before installing the descriptor', () => {
        const f = fixture();
        expect(() =>
            admitHistoricalStack(f.input, {
                ...f.port,
                installDescriptor: () => {
                    throw new Error('interrupted');
                },
            })
        ).toThrow('interrupted');
        expect(f.receipt()).toBeDefined();
        expect(f.stored()).toBeUndefined();
        expect(f.port.markers()).toEqual([anchor]);
        expect(admitHistoricalStack(f.input, f.port).forkHead).toBe(anchor);
        expect(f.stored()).toBeDefined();
    });

    it('resumes a receipt-only crash and rejects a changed record instead of overwriting it', () => {
        const f = fixture();
        expect(() =>
            admitHistoricalStack(f.input, {
                ...f.port,
                addMarker: () => {
                    throw new Error('interrupted');
                },
            })
        ).toThrow('interrupted');
        expect(f.receipt()).toBeDefined();
        expect(f.port.markers()).toEqual([]);
        expect(admitHistoricalStack(f.input, f.port).forkHead).toBe(anchor);
        const g = fixture();
        admitHistoricalStack(g.input, g.port);
        g.setMarkers([sha('f')]);
        expect(() => admitHistoricalStack(g.input, g.port)).toThrow(/conflicting/);
    });

    it('revalidates remote and native facts before marker and final descriptor mutations', () => {
        for (const at of ['receipt', 'marker']) {
            const f = fixture();
            const port = {
                ...f.port,
                saveReceipt: (r: HistoricalAdmissionReceipt) => {
                    f.port.saveReceipt(r);
                    if (at === 'receipt') {
                        f.setObservation({
                            ...f.observation(),
                            parent: { ...f.observation().parent, headSha: sha('f') },
                        });
                    }
                },
                addMarker: (value: string) => {
                    f.port.addMarker(value);
                    if (at === 'marker') {
                        f.setHead(sha('b'));
                    }
                },
            };
            expect(() => admitHistoricalStack(f.input, port)).toThrow(/changed/);
            expect(f.stored()).toBeUndefined();
        }
    });
});

function closedParentFixture() {
    const f = fixture();
    const observation = f.observation();
    observation.child.baseRefOid = anchor;
    observation.child.merged = false;
    observation.child.closedAt = null;
    observation.parent = {
        ...observation.parent,
        state: 'CLOSED',
        merged: false,
        closedAt: '2026-10-24T08:48:24Z',
        baseRefOid: sha('e'),
        events: ['ClosedEvent'],
        closures: [{ id: 'close-node', createdAt: '2026-10-24T08:48:24Z', authorId: AUTHOR_BOT_NODE_ID }],
    };
    observation.closedParentCompletion = '{"native":"initial-proof"}';
    f.setObservation(observation);
    const input = { ...f.input, closedParent: { replacementPullRequest: 5636, parentOriginMain: true } };
    return { f, input };
}

describe('explicit superseded parent historical admission', () => {
    it('registers the original fork against a currently closed parent, allowing the native parent-only origin/main genesis', () => {
        const { f, input } = closedParentFixture();
        f.setParentLog(
            f.port.parentLog().replace(`branch: Created from ${sha('e')}`, 'branch: Created from origin/main')
        );
        const descriptor = admitHistoricalStack(input, {
            ...f.port,
            readReceipt: () => {
                const value = f.receipt();
                return value === undefined
                    ? undefined
                    : parseHistoricalAdmissionReceipt(JSON.parse(JSON.stringify(value)));
            },
        });
        expect(descriptor).toMatchObject({
            childBranch,
            parentBranch,
            parentPullRequest: 5425,
            forkHead: anchor,
            parentHead: parent,
        });
        expect(f.writes).toEqual(['receipt', 'marker', 'descriptor']);
        expect(f.receipt()).toMatchObject({
            version: 2,
            closedParent: { replacementPullRequest: 5636, parentOriginMain: true, proof: '{"native":"initial-proof"}' },
        });
        expect(admitHistoricalStack(input, f.port)).toEqual(descriptor);
        expect(f.writes).toHaveLength(3);
        expect(() =>
            syncParentLane(descriptor, {
                ...f.port,
                main: () => sha('c'),
                parents: () => [
                    {
                        number: 5425,
                        branch: parentBranch,
                        headSha: parent,
                        state: 'CLOSED',
                        authorId: AUTHOR_BOT_NODE_ID,
                        repository: REQUIRED_REPOSITORY,
                    },
                ],
                fetchParent: () => undefined,
                merge: () => {
                    throw new Error('must not merge');
                },
                conflicts: () => [],
                save: () => {
                    throw new Error('must not save');
                },
            })
        ).toThrow('stack parent closed without merging');
    });

    it('keeps A-close/B-current provenance parity: local history may precede the current remote head', () => {
        const { f, input } = closedParentFixture();
        expect(f.port.parentLocalHead()).toBe(next);
        expect(f.observation().parent.headSha).toBe(parent);
        expect(admitHistoricalStack(input, f.port).parentHead).toBe(parent);
        // No historical head-at-close attestation was inferred from a plain receipt.
        expect(f.receipt()?.descriptor.forkHead).toBe(anchor);
    });

    it.each([
        'missing flag',
        'wrong actor',
        'wrong base',
        'reopened parent',
        'wrong closure actor',
        'closure before child',
        'wrong parent at birth',
        'child origin/main',
        'arbitrary parent origin',
        'missing origin flag',
        'cached base absent',
        'cached base unrelated',
        'dirty child',
    ])('refuses %s without writes', (change) => {
        const { f, input } = closedParentFixture();
        const observation = f.observation();
        if (change === 'wrong actor') observation.parent.authorId = 'foreign';
        if (change === 'wrong base') observation.child.baseBranch = 'agent/other';
        if (change === 'reopened parent') observation.parent.events.push('ReopenedEvent');
        if (change === 'wrong closure actor' && observation.parent.closures?.[0])
            observation.parent.closures[0].authorId = 'foreign';
        if (change === 'closure before child') observation.parent.closedAt = '2026-10-20T00:00:00Z';
        if (change === 'wrong parent at birth') f.setParentLog(f.port.parentLog().replaceAll(anchor, sha('d')));
        if (change === 'child origin/main')
            f.setChildLog(
                f.port.childLog().replace(`branch: Created from ${anchor}`, 'branch: Created from origin/main')
            );
        if (change === 'arbitrary parent origin')
            f.setParentLog(
                f.port.parentLog().replace(`branch: Created from ${sha('e')}`, 'branch: Created from agent/other')
            );
        if (change === 'missing origin flag') {
            f.setParentLog(
                f.port.parentLog().replace(`branch: Created from ${sha('e')}`, 'branch: Created from origin/main')
            );
            input.closedParent.parentOriginMain = false;
        }
        if (change === 'cached base absent') delete observation.child.baseRefOid;
        if (change === 'cached base unrelated') observation.child.baseRefOid = sha('d');
        if (change === 'dirty child') f.setClean(false);
        expect(() => admitHistoricalStack(change === 'missing flag' ? f.input : input, f.port)).toThrow();
        expect(f.writes).toEqual([]);
    });

    it('leaves existing OPEN genesis admission strict', () => {
        const f = fixture();
        f.setParentLog(
            f.port.parentLog().replace(`branch: Created from ${sha('e')}`, 'branch: Created from origin/main')
        );
        expect(() => admitHistoricalStack(f.input, f.port)).toThrow('native branch creation record missing');
        expect(f.writes).toEqual([]);
    });

    it.each(['receipt', 'marker', 'descriptor'])('journals and exactly resumes a crash at %s', (phase) => {
        const { f, input } = closedParentFixture();
        const port = {
            ...f.port,
            saveReceipt: (receipt: HistoricalAdmissionReceipt) => {
                f.port.saveReceipt(receipt);
                if (phase === 'receipt') throw new Error('crash');
            },
            addMarker: (fork: string) => {
                f.port.addMarker(fork);
                if (phase === 'marker') throw new Error('crash');
            },
            installDescriptor: (value: LaneStack) => {
                f.port.installDescriptor(value);
                if (phase === 'descriptor') throw new Error('crash');
            },
        };
        expect(() => admitHistoricalStack(input, port)).toThrow('crash');
        expect(f.receipt()?.version).toBe(2);
        expect(() => admitHistoricalStack(f.input, f.port)).toThrow();
        expect(() =>
            admitHistoricalStack({ ...input, closedParent: { ...input.closedParent, parentOriginMain: false } }, f.port)
        ).toThrow('flags changed');
        const snapshot = f.observation().closedParentCompletion;
        f.observation().closedParentCompletion = '{"native":"moved"}';
        expect(() => admitHistoricalStack(input, f.port)).toThrow('flags changed');
        f.observation().closedParentCompletion = snapshot;
        expect(admitHistoricalStack(input, f.port).parentPullRequest).toBe(5425);
    });

    it.each([2, 3, 4, 5])('repeats the native completion at observation boundary %s', (boundary) => {
        const { f, input } = closedParentFixture();
        let observations = 0;
        expect(() =>
            admitHistoricalStack(input, {
                ...f.port,
                observe: () => {
                    observations += 1;
                    if (observations === boundary) f.observation().closedParentCompletion = '{"native":"changed"}';
                    return f.port.observe();
                },
            })
        ).toThrow('changed during admission');
        expect(observations).toBe(boundary);
        expect(f.writes).toHaveLength(Math.min(boundary - 2, 3));
    });

    it('requires bounded strict version2 records and exact explicit CLI flags', () => {
        const { f, input } = closedParentFixture();
        admitHistoricalStack(input, f.port);
        const receipt = f.receipt();
        expect(parseHistoricalAdmissionReceipt(receipt)).toEqual(receipt);
        for (const changed of [
            { ...receipt, extra: true },
            { ...receipt, closedParent: { ...input.closedParent, proof: 'x'.repeat(32769) } },
            { ...receipt, closedParent: { ...input.closedParent, proof: 'ok', extra: true } },
        ]) {
            expect(() => parseHistoricalAdmissionReceipt(changed)).toThrow();
        }
        const base = [
            '--lane',
            '/owned/child',
            '--admit-historical',
            '--child-pr',
            '5438',
            '--parent-pr',
            '5425',
            '--expected-head',
            child,
        ];
        expect(
            parseSyncParentArgs([...base, '--superseded-parent-replacement', '5636', '--parent-origin-main']).admission
                ?.closedParent
        ).toEqual({ replacementPullRequest: 5636, parentOriginMain: true });
        for (const suffix of [
            ['--parent-origin-main'],
            ['--superseded-parent-replacement', '5425'],
            ['--superseded-parent-replacement', '5636', '--legacy-fork', anchor],
            ['--superseded-parent-replacement', '5636', '--unknown'],
        ]) {
            expect(() => parseSyncParentArgs([...base, ...suffix])).toThrow();
        }
    });

    it('uses the frozen Node/primary native tuple, strips tokens/loaders/overrides and adds only Darwin system ps', () => {
        const { f, input } = closedParentFixture();
        const invocation = nativeParentInspectionInvocation(
            {
                primaryRoot: '/primary',
                gitPath: '/frozen/git/bin/git',
                ghPath: '/frozen/gh/bin/gh',
                localEnv: {
                    PATH: '/evil',
                    GH_TOKEN: ['private', 'fixture'].join('-'),
                    NODE_OPTIONS: '--import=/evil',
                    SOURDAW_TRUSTED_PRIMARY_ROOT: '/evil',
                    npm_execpath: '/evil/package',
                },
            },
            input.closedParent,
            f.observation().parent,
            'darwin',
            () => undefined
        );
        expect(invocation.command).toBe(process.execPath);
        expect(invocation.cwd).toBe('/primary');
        expect(invocation.args).toEqual([
            '/primary/scripts/trustedGithubWriteBootstrap.ts',
            'pr:supersede',
            '--inspect-parent-completion',
            '--parent-pr',
            '5425',
            '--expected-head',
            parent,
            '--replacement',
            '5636',
        ]);
        expect(invocation.env.GH_TOKEN).toBeUndefined();
        expect(invocation.env.NODE_OPTIONS).toBeUndefined();
        expect(invocation.env.SOURDAW_TRUSTED_PRIMARY_ROOT).toBeUndefined();
        expect(invocation.env.PATH).not.toContain('/evil');
        expect(invocation.env.PATH?.split(':').at(-1)).toBe('/bin');
        expect(JSON.stringify(invocation.args)).not.toContain('private');
        expect(() =>
            nativeParentInspectionInvocation(
                { primaryRoot: '/primary', gitPath: '/git', ghPath: '/gh', localEnv: {} },
                input.closedParent,
                f.observation().parent,
                'linux',
                () => undefined
            )
        ).toThrow('only on Darwin');
        expect(() =>
            nativeParentInspectionInvocation(
                { primaryRoot: '/primary', gitPath: '/git', ghPath: '/gh', localEnv: {} },
                input.closedParent,
                f.observation().parent,
                'darwin',
                () => {
                    throw new Error('missing system ps');
                }
            )
        ).toThrow('missing system ps');
    });
});

function nativeCompletionWire() {
    const { f, input } = closedParentFixture();
    const core = {
        number: 5425,
        head: parent,
        headRefName: parentBranch,
        base: 'main',
        baseRefOid: sha('e'),
        headRepository: REQUIRED_REPOSITORY,
        repository: REQUIRED_REPOSITORY,
        state: 'CLOSED',
        merged: false,
        closedAt: '2026-10-24T08:48:24Z',
        mergeCommit: null,
    };
    const marker = {
        id: 'marker',
        fullDatabaseId: '123',
        authorNodeId: AUTHOR_BOT_NODE_ID,
        authorType: 'Bot',
        body: 'native bytes',
    };
    const payload = {
        version: 1,
        sourceCommit: sha('9'),
        parent: core,
        replacement: {
            ...core,
            number: 5636,
            state: 'MERGED',
            headRefName: 'fix/replacement',
            merged: true,
            mergeCommit: sha('f'),
        },
        receipt: marker,
        lineage: { ...marker, id: 'lineage' },
        findingIds: ['1001'],
    };
    return { f, input, payload, wire: () => canonicalJson(payload) + '\n' };
}

describe('bounded native parent inspection transport', () => {
    it('accepts only the exact bound source and original/current identities, with one complete output', () => {
        const { f, input, payload, wire } = nativeCompletionWire();
        f.observation().closedParentCompletion = checkedNativeParentCompletion(
            wire(),
            f.observation().parent,
            5636,
            sha('9')
        );
        expect(f.observation().closedParentCompletion).toBe(wire().slice(0, -1));
        expect(admitHistoricalStack(input, f.port).parentPullRequest).toBe(5425);
        for (const invalid of [
            wire() + '\n',
            'banner\n' + wire(),
            wire().trim(),
            '{}\n',
            wire().replace('sourceCommit', 'unknown'),
            'x'.repeat(32770),
        ]) {
            expect(() => checkedNativeParentCompletion(invalid, f.observation().parent, 5636, sha('9'))).toThrow();
        }
        expect(() => checkedNativeParentCompletion(wire(), f.observation().parent, 5636, sha('8'))).toThrow(
            'source changed'
        );
        for (const change of ['head', 'branch', 'replacement', 'merge', 'marker actor', 'roots']) {
            const row = structuredClone(payload);
            if (change === 'head') row.parent.head = sha('d');
            if (change === 'branch') row.parent.headRefName = 'agent/other';
            if (change === 'replacement') row.replacement.number = 9999;
            if (change === 'merge') row.replacement.mergeCommit = 'main';
            if (change === 'marker actor') row.receipt.authorNodeId = 'foreign';
            if (change === 'roots') row.findingIds = ['1001', '1001'];
            expect(() =>
                checkedNativeParentCompletion(canonicalJson(row) + '\n', f.observation().parent, 5636, sha('9'))
            ).toThrow();
        }
    });

    it('launches the actual registered bootstrap and read-only supersession closure in a private repository', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-parent-inspection-native-'));
        const bin = join(root, 'bin');
        mkdirSync(bin);
        const gitPath = realpathSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim());
        const env = {
            ...process.env,
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_SYSTEM: '/dev/null',
            GIT_AUTHOR_NAME: 'Native fixture',
            GIT_AUTHOR_EMAIL: 'fixture@example.test',
            GIT_COMMITTER_NAME: 'Native fixture',
            GIT_COMMITTER_EMAIL: 'fixture@example.test',
        };
        const git = (...args: string[]) =>
            execFileSync(gitPath, args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        for (const file of trustedDependencyGraphs['pr:supersede']) {
            mkdirSync(join(root, file, '..'), { recursive: true });
            writeFileSync(join(root, file), readFileSync(join(process.cwd(), file)));
        }
        const identityPath = join(root, 'scripts/githubAppIdentity.ts');
        const identity = readFileSync(identityPath, 'utf8');
        const start = identity.indexOf('export async function authenticateRole(');
        const end = identity.indexOf('const AUTHOR_WORKFLOW_PATH_PREFIX', start);
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
        writeFileSync(
            identityPath,
            identity.slice(0, start) +
                `export async function authenticateRole() {
            return { minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session: { configDir: ${JSON.stringify(root)}, env: process.env, dispose() {} } };
        }\n` +
                identity.slice(end)
        );
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify({
                type: 'module',
                scripts: {
                    'pr:supersede': 'node scripts/trustedGithubWriteBootstrap.ts pr:supersede',
                },
            })
        );
        const { f, input, payload } = nativeCompletionWire();
        const lineage = renderFindingLineage({ format: 'lineage-v1', oldPr: 5425, replacementPr: 5636, entries: [] });
        const comments = [
            {
                id: 'receipt',
                fullDatabaseId: '123',
                body: 'Superseded by #5636.',
                author: { id: AUTHOR_BOT_NODE_ID, __typename: 'Bot', login: 'native' },
            },
            {
                id: 'lineage',
                fullDatabaseId: '124',
                body: lineage,
                author: { id: AUTHOR_BOT_NODE_ID, __typename: 'Bot', login: 'native' },
            },
        ];
        const ghPath = join(bin, 'gh');
        writeFileSync(
            ghPath,
            `#!${process.execPath}
import fs from 'node:fs';
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(root, 'read-commands.jsonl'))}, JSON.stringify({args,token:process.env.GH_TOKEN??null,loader:process.env.NODE_OPTIONS??null})+String.fromCharCode(10));
const query=args.find(a=>a.startsWith('query='))??'';
if(query.includes('mutation')) { process.stderr.write('mutation forbidden'); process.exit(97); }
const number=Number((args.find(a=>a.startsWith('number='))??'number=5425').split('=')[1]);
const parent=${JSON.stringify(payload.parent)}, replacement=${JSON.stringify(payload.replacement)};
const c=number===5425?parent:replacement;
let result;
if(query.includes('reviewThreads')) result={data:{repository:{pullRequest:{reviewThreads:{nodes:[],pageInfo:{hasNextPage:false}}}}}};
else if(query.includes('node(id:')) { const subject=(args.find(a=>a.startsWith('subjectId='))??'subjectId=PR_5425').split('=')[1]; result={data:{node:{id:subject,comments:{nodes:subject==='PR_5425'?${JSON.stringify(comments)}:[],pageInfo:{hasNextPage:false}}}}}; }
else result={data:{repository:{nameWithOwner:${JSON.stringify(REQUIRED_REPOSITORY)},pullRequest:{id:'PR_'+number,number,state:c.state,headRefOid:c.head,headRefName:c.headRefName,headRepository:{nameWithOwner:c.headRepository},baseRefName:c.base,baseRefOid:c.baseRefOid,baseRef:null,merged:c.merged,closedAt:c.closedAt,mergeCommit:c.mergeCommit?{oid:c.mergeCommit}:null}}}};
process.stdout.write(JSON.stringify(result));
`
        );
        chmodSync(ghPath, 0o700);
        execFileSync(process.execPath, ['--check', ghPath], { encoding: 'utf8', stdio: 'pipe' });
        git('init', '-b', 'main');
        git('add', '.');
        git('commit', '-m', 'test: isolated native inspection');
        git('remote', 'add', 'origin', root);
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        const source = git('rev-parse', 'HEAD');
        const invocation = nativeParentInspectionInvocation(
            {
                primaryRoot: root,
                gitPath,
                ghPath,
                localEnv: {
                    ...env,
                    GH_TOKEN: ['secret', 'probe'].join('-'),
                    NODE_OPTIONS: '--import=/missing-evil-loader',
                    PATH: '/missing-evil-bin',
                    SOURDAW_TRUSTED_PRIMARY_ROOT: '/foreign',
                    npm_execpath: '/foreign/package',
                },
            },
            input.closedParent,
            f.observation().parent,
            'darwin'
        );
        const raw = execFileSync(invocation.command, invocation.args, {
            cwd: invocation.cwd,
            env: invocation.env,
            encoding: 'utf8',
            timeout: 15000,
        });
        expect(checkedNativeParentCompletion(raw, f.observation().parent, 5636, source)).toContain(
            'Superseded by #5636.'
        );
        const reads = readFileSync(join(root, 'read-commands.jsonl'), 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(reads.length).toBeGreaterThan(5);
        expect(reads.every((row) => row.token === null && row.loader === null)).toBe(true);
        expect(reads.every((row) => !row.args.some((arg: string) => arg.includes('mutation')))).toBe(true);
        expect(git('for-each-ref', '--format=%(refname)', 'refs/sourdaw')).toBe('');
        expect(() => checkedNativeParentCompletion(raw, f.observation().parent, 5636, sha('8'))).toThrow(
            'source changed'
        );
        // The outer primary boundary is real: a mutated local launcher cannot execute inspection.
        writeFileSync(
            join(root, 'scripts/trustedGithubWriteBootstrap.ts'),
            readFileSync(join(root, 'scripts/trustedGithubWriteBootstrap.ts'), 'utf8') + '\n// local drift\n'
        );
        expect(() =>
            execFileSync(invocation.command, invocation.args, {
                cwd: invocation.cwd,
                env: invocation.env,
                encoding: 'utf8',
                stdio: 'pipe',
                timeout: 15000,
            })
        ).toThrow('does not match its pinned');
    });
});

describe('closed parent shell observation boundaries', () => {
    // Closed registration admits only the Darwin system-tool boundary.
    it
        .runIf(process.platform === 'darwin')
        .each([
            'stable',
            'child moves',
            'parent moves',
            'base ref moves',
            'final query errors',
            'truncated lifecycle',
            'source changes',
            'inspection fails',
        ])('binds freshly inspected completion: %s', (change) => {
        const { f, input, wire } = nativeCompletionWire();
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-closed-observer-'));
        const remote = (pr: HistoricalStackObservation['parent']) => ({
            id: pr.id,
            number: pr.number,
            createdAt: pr.createdAt,
            state: pr.state,
            merged: pr.merged ?? false,
            closedAt: pr.closedAt ?? null,
            baseRefOid: pr.baseRefOid,
            author: { id: pr.authorId },
            repository: { id: pr.repositoryId, nameWithOwner: pr.repository },
            headRepository: { id: pr.headRepositoryId, nameWithOwner: pr.headRepository },
            headRefName: pr.branch,
            headRefOid: pr.headSha,
            headRef: { name: pr.branch, target: { oid: pr.headSha } },
            baseRefName: pr.baseBranch,
            baseRef: { name: pr.baseBranch, target: { oid: parent } },
            timelineItems: {
                pageInfo: { hasNextPage: change === 'truncated lifecycle' },
                nodes: pr.events.map((event) =>
                    event === 'ClosedEvent'
                        ? {
                              __typename: event,
                              id: 'close-node',
                              createdAt: pr.closedAt,
                              actor: { id: AUTHOR_BOT_NODE_ID },
                          }
                        : { __typename: event }
                ),
            },
        });
        const candidates = (pr: HistoricalStackObservation['parent']) =>
            JSON.stringify([
                [
                    {
                        number: pr.number,
                        state: pr.state.toLowerCase(),
                        merged_at: null,
                        head: { ref: pr.branch, sha: pr.headSha, repo: { full_name: pr.repository } },
                        user: { node_id: pr.authorId },
                    },
                ],
            ]);
        let queries = 0;
        let inspections = 0;
        const port = historicalAdmissionShellPort(
            {
                lane: root,
                branch: childBranch,
                primaryRoot: root,
                gitPath: '/fixed/git',
                ghPath: '/fixed/gh',
                originCommit: sha('9'),
                localEnv: {},
                session: { configDir: root, env: { GH_TOKEN: ['ghs', 'fixture'].join('_') }, dispose: () => undefined },
                run: () => undefined,
                capture: (command, args, options) => {
                    if (command === process.execPath) {
                        inspections += 1;
                        expect(args.slice(0, 3)).toEqual([
                            join(root, 'scripts/trustedGithubWriteBootstrap.ts'),
                            'pr:supersede',
                            '--inspect-parent-completion',
                        ]);
                        expect(options?.cwd).toBe(root);
                        if (change === 'inspection fails') throw new Error('inspection subprocess failed');
                        return change === 'source changes' ? wire().replace(sha('9'), sha('8')) : wire();
                    }
                    if (args[0] === 'api' && args[1] === 'graphql') {
                        queries += 1;
                        if (queries % 2 === 0 && change === 'final query errors')
                            return JSON.stringify({ errors: [{ message: 'unavailable' }] });
                        const childPr = remote(f.observation().child);
                        if (queries % 2 === 0 && change === 'child moves') {
                            childPr.headRefOid = sha('d');
                            childPr.headRef.target.oid = sha('d');
                        }
                        const parentPr = remote(f.observation().parent);
                        if (queries % 2 === 0 && change === 'parent moves') {
                            parentPr.headRefOid = sha('d');
                            parentPr.headRef.target.oid = sha('d');
                        }
                        if (queries % 2 === 0 && change === 'base ref moves') childPr.baseRef.target.oid = sha('d');
                        return JSON.stringify({ data: { repository: { child: childPr, parent: parentPr } } });
                    }
                    if (args[0] === 'api')
                        return candidates(
                            args[3]?.includes(encodeURIComponent(childBranch))
                                ? f.observation().child
                                : f.observation().parent
                        );
                    if (args[0] === 'rev-parse') return parent;
                    throw new Error('unexpected observer operation');
                },
            },
            input
        );
        if (change === 'stable') {
            expect(port.observe().closedParentCompletion).toBe(wire().trim());
            expect(port.observe().closedParentCompletion).toBe(wire().trim());
            expect(inspections).toBe(2);
            expect(queries).toBe(4);
        } else expect(() => port.observe()).toThrow();
    });
});

describe('version2 registered-lineage reader', () => {
    it('refuses a receipt-only or missing-marker completion and preserves its exact flags/proof on disk', () => {
        const { f, input } = closedParentFixture();
        const descriptor = admitHistoricalStack(input, f.port);
        const receipt = f.receipt();
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-closed-journal-'));
        mkdirSync(join(root, '.agents/lane-stacks'), { recursive: true });
        writeFileSync(laneStackPath(root, childBranch) + '.admission.json', JSON.stringify(receipt));
        expect(() => readRegisteredLaneStack(root, childBranch, configWithForkMarkers(childBranch))).toThrow(
            'incomplete'
        );
        writeLaneStack(root, descriptor);
        expect(() => readRegisteredLaneStack(root, childBranch, configWithForkMarkers(childBranch))).toThrow();
        expect(readRegisteredLaneStack(root, childBranch, configWithForkMarkers(childBranch, anchor))).toEqual(
            descriptor
        );
        expect(JSON.parse(readFileSync(laneStackPath(root, childBranch) + '.admission.json', 'utf8'))).toEqual(receipt);
    });
});
