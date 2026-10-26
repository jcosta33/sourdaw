import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    AUTHOR_BOT_COMMIT_EMAIL,
    AUTHOR_BOT_COMMIT_NAME,
    AUTHOR_BOT_NODE_ID,
    REQUIRED_REPOSITORY,
} from '../githubAppIdentity.ts';
import { laneStackPath, readRegisteredLaneStack, writeLaneStack, type LaneStack } from '../stackedLanes.ts';
import {
    admitHistoricalStack,
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

describe('historical stack native admission', () => {
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
        expect(() => readRegisteredLaneStack(root, childBranch, '')).toThrow(/historical admission/);
        port.addMarker(anchor);
        expect(port.markers()).toEqual([anchor]);
        port.installDescriptor(stack);
        port.installDescriptor(stack);
        expect(readRegisteredLaneStack(root, childBranch, anchor)).toEqual(stack);
        expect(() => port.installDescriptor({ ...stack, parentPullRequest: 9999 })).toThrow();
        expect(port.readDescriptor()).toEqual(stack);
        port.addMarker(anchor);
        expect(port.markers()).toEqual([anchor, anchor]);
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
        for (const invalid of [
            args.slice(0, -2),
            [...args, '--force'],
            args.map((v) => (v === '5425' ? '5438' : v)),
            args.map((v) => (v === child ? 'HEAD' : v)),
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
        expect(() => readRegisteredLaneStack(root, pending.childBranch, '')).toThrow(/historical admission/);
        writeFileSync(`${path}.admission.json`, JSON.stringify(f.receipt()));
        expect(readRegisteredLaneStack(root, childBranch, anchor)).toEqual(stack);
        writeLaneStack(root, { ...stack, parentHead: sha('f') });
        expect(readRegisteredLaneStack(root, childBranch, anchor)?.parentHead).toBe(sha('f'));
        writeFileSync(path, JSON.stringify({ ...stack, parentPullRequest: 9999 }));
        expect(() => readRegisteredLaneStack(root, childBranch, anchor)).toThrow(/historical admission/);
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

    it.each([
        'moved child',
        'foreign child',
        'wrong repository',
        'retargeted child',
        'reused parent',
        'replacement parent',
        'deleted parent',
        'force pushed parent',
        'late parent',
        'dirty child',
    ])('refuses %s before any record write', (change) => {
        const f = fixture();
        const remote = f.observation();
        if (change === 'moved child') {
            f.setHead(sha('b'));
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
        expect(() => admitHistoricalStack(f.input, f.port)).toThrow();
        expect(f.writes).toEqual([]);
    });

    it.each([
        'missing birth',
        'wrong actor',
        'ambiguous time',
        'parent at another commit',
        'discontinuous log',
        'rewritten log',
        'unrelated history',
    ])('refuses %s as a historical creation witness', (change) => {
        const f = fixture();
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
        const port = change === 'unrelated history' ? { ...f.port, isAncestor: () => false } : f.port;
        expect(() => admitHistoricalStack(f.input, port)).toThrow();
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
