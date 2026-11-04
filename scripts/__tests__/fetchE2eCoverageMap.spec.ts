import { describe, expect, it } from 'vitest';

import { fetchCoverageMap, type FetchDependencies, type FetchEnvironment } from '../fetchE2eCoverageMap';

const REPOSITORY = 'jcosta33/sourdaw';
const API = 'https://api.example.test';
const SHA = (digit: string): string => digit.repeat(40);

type ArtifactFixture = {
    id: number;
    runId: number;
    createdAt: string;
    headSha: string;
    branch?: string;
    expired?: boolean;
};
type RunFixture = { path?: string; event?: string; branch?: string; repository?: string; headRepository?: string };

function artifact(fixture: ArtifactFixture): Record<string, unknown> {
    return {
        id: fixture.id,
        name: 'e2e-coverage-map',
        expired: fixture.expired ?? false,
        created_at: fixture.createdAt,
        size_in_bytes: 2048,
        archive_download_url: `${API}/zip/${fixture.id}`,
        workflow_run: { id: fixture.runId, head_branch: fixture.branch ?? 'main', head_sha: fixture.headSha },
    };
}

function run(id: number, headSha: string, fixture: RunFixture = {}): Record<string, unknown> {
    return {
        id,
        path: fixture.path ?? '.github/workflows/nightly.yml',
        event: fixture.event ?? 'schedule',
        head_branch: fixture.branch ?? 'main',
        head_sha: headSha,
        repository: { full_name: fixture.repository ?? REPOSITORY },
        head_repository: { full_name: fixture.headRepository ?? REPOSITORY },
    };
}

function mapFor(commit: string): string {
    return JSON.stringify({
        format: 'e2e-coverage-map-v1',
        commit,
        specs: ['tests/e2e/alpha.spec.ts'],
        alwaysSelect: [],
        files: { 'src/a.ts': { blob: SHA('a'), specs: [0] } },
    });
}

type Harness = {
    dependencies: FetchDependencies;
    written: Map<string, string>;
    outputs: string[];
    logs: string[];
    requests: string[];
};

function harness(
    routes: Readonly<Record<string, () => Response>>,
    archives: Readonly<Record<string, string>> = {}
): Harness {
    const written = new Map<string, string>();
    const outputs: string[] = [];
    const logs: string[] = [];
    const requests: string[] = [];
    return {
        written,
        outputs,
        logs,
        requests,
        dependencies: {
            fetch: async (url) => {
                requests.push(url);
                const route = routes[url];
                return route === undefined ? new Response('not found', { status: 404 }) : route();
            },
            extract: (archive) => {
                const text = archives[new TextDecoder().decode(archive)];
                if (text === undefined) {
                    throw new Error('member missing');
                }
                return text;
            },
            writeMap: (path, text) => written.set(path, text),
            appendOutput: (line) => outputs.push(line),
            log: (line) => logs.push(line),
        },
    };
}

const ENVIRONMENT: FetchEnvironment = { token: 'token', repository: REPOSITORY, apiUrl: API, mapPath: '/tmp/map.json' };
const LISTING = `${API}/repos/${REPOSITORY}/actions/artifacts?name=e2e-coverage-map&per_page=100`;
const json = (value: unknown) => () => Response.json(value);
const zip = (name: string) => () => new Response(name);

describe('nightly coverage map retrieval', () => {
    it('takes the newest artifact a scheduled nightly on main uploaded, skipping untrusted newer ones', async () => {
        const artifacts = [
            artifact({ id: 1, runId: 11, createdAt: '2026-10-30T03:40:00Z', headSha: SHA('1') }),
            artifact({ id: 5, runId: 15, createdAt: '2026-11-01T05:00:00Z', headSha: SHA('5'), branch: 'ci/e2e' }),
            artifact({ id: 3, runId: 13, createdAt: '2026-10-31T03:40:00Z', headSha: SHA('3') }),
            artifact({ id: 4, runId: 14, createdAt: '2026-11-01T03:40:00Z', headSha: SHA('4') }),
            artifact({ id: 6, runId: 16, createdAt: '2026-11-01T06:00:00Z', headSha: SHA('6'), expired: true }),
        ];
        const { dependencies, written, outputs, requests } = harness(
            {
                [LISTING]: json({ total_count: artifacts.length, artifacts }),
                [`${API}/repos/${REPOSITORY}/actions/runs/14`]: json(run(14, SHA('4'), { event: 'pull_request' })),
                [`${API}/repos/${REPOSITORY}/actions/runs/13`]: json(run(13, SHA('3'), { event: 'workflow_dispatch' })),
                [`${API}/zip/3`]: zip('three'),
            },
            { three: mapFor(SHA('3')) }
        );
        await fetchCoverageMap(ENVIRONMENT, dependencies);
        expect(requests).toEqual([
            LISTING,
            `${API}/repos/${REPOSITORY}/actions/runs/14`,
            `${API}/repos/${REPOSITORY}/actions/runs/13`,
            `${API}/zip/3`,
        ]);
        expect([...written]).toEqual([['/tmp/map.json', mapFor(SHA('3'))]]);
        expect(outputs).toEqual(['created-at=2026-10-31T03:40:00Z']);
    });

    it.each([
        ['a pull-request run', { event: 'pull_request' }],
        ['a fork head repository', { headRepository: 'fork/sourdaw' }],
        ['another repository', { repository: 'other/sourdaw' }],
        ['another workflow file', { path: '.github/workflows/pr-checks.yml' }],
        ['a run on another branch', { branch: 'feature' }],
    ])('rejects an artifact from %s and writes nothing', async (_, fixture: RunFixture) => {
        const artifacts = [artifact({ id: 2, runId: 12, createdAt: '2026-11-01T03:40:00Z', headSha: SHA('2') })];
        const { dependencies, written, outputs, logs } = harness(
            {
                [LISTING]: json({ artifacts }),
                [`${API}/repos/${REPOSITORY}/actions/runs/12`]: json(run(12, SHA('2'), fixture)),
                [`${API}/zip/2`]: zip('two'),
            },
            { two: mapFor(SHA('2')) }
        );
        await fetchCoverageMap(ENVIRONMENT, dependencies);
        expect(written.size).toBe(0);
        expect(outputs).toEqual([]);
        expect(logs).toEqual([
            'e2e coverage map unavailable; the full browser suite stays selected: no artifact from a scheduled or dispatched nightly on main',
        ]);
    });

    it('never downloads an expired artifact', async () => {
        const artifacts = [
            artifact({ id: 2, runId: 12, createdAt: '2026-11-01T03:40:00Z', headSha: SHA('2'), expired: true }),
        ];
        const { dependencies, written, requests } = harness({ [LISTING]: json({ artifacts }) });
        await fetchCoverageMap(ENVIRONMENT, dependencies);
        expect(requests).toEqual([LISTING]);
        expect(written.size).toBe(0);
    });

    it.each([
        ['the listing fails', { [LISTING]: () => new Response('boom', { status: 500 }) }, {}],
        [
            'the run lookup fails',
            {
                [LISTING]: json({
                    artifacts: [artifact({ id: 2, runId: 12, createdAt: '2026-11-01T03:40:00Z', headSha: SHA('2') })],
                }),
                [`${API}/repos/${REPOSITORY}/actions/runs/12`]: () => new Response('gone', { status: 403 }),
            },
            {},
        ],
        [
            'the download fails',
            {
                [LISTING]: json({
                    artifacts: [artifact({ id: 2, runId: 12, createdAt: '2026-11-01T03:40:00Z', headSha: SHA('2') })],
                }),
                [`${API}/repos/${REPOSITORY}/actions/runs/12`]: json(run(12, SHA('2'))),
                [`${API}/zip/2`]: () => new Response('expired', { status: 410 }),
            },
            {},
        ],
        [
            'the archive holds another commit',
            {
                [LISTING]: json({
                    artifacts: [artifact({ id: 2, runId: 12, createdAt: '2026-11-01T03:40:00Z', headSha: SHA('2') })],
                }),
                [`${API}/repos/${REPOSITORY}/actions/runs/12`]: json(run(12, SHA('2'))),
                [`${API}/zip/2`]: zip('two'),
            },
            { two: mapFor(SHA('9')) },
        ],
        [
            'the archive holds the wrong format',
            {
                [LISTING]: json({
                    artifacts: [artifact({ id: 2, runId: 12, createdAt: '2026-11-01T03:40:00Z', headSha: SHA('2') })],
                }),
                [`${API}/repos/${REPOSITORY}/actions/runs/12`]: json(run(12, SHA('2'))),
                [`${API}/zip/2`]: zip('two'),
            },
            { two: '{"format":"e2e-coverage-map-v0"}' },
        ],
    ])('writes nothing and resolves when %s', async (_, routes, archives) => {
        const { dependencies, written, outputs, logs } = harness(routes, archives);
        await expect(fetchCoverageMap(ENVIRONMENT, dependencies)).resolves.toBeUndefined();
        expect(written.size).toBe(0);
        expect(outputs).toEqual([]);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatch(/^e2e coverage map unavailable; the full browser suite stays selected: /);
    });

    it('writes nothing without a token or a destination', async () => {
        for (const environment of [
            { ...ENVIRONMENT, token: undefined },
            { ...ENVIRONMENT, mapPath: undefined },
        ]) {
            const { dependencies, written, requests } = harness({});
            await fetchCoverageMap(environment, dependencies);
            expect(requests).toEqual([]);
            expect(written.size).toBe(0);
        }
    });
});
