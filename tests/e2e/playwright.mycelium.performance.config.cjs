const path = require('node:path');
const childProcess = require('node:child_process');
const os = require('node:os');

const { defineConfig } = require('@playwright/test');

const port = 52_744;
const harnessRoot = path.resolve(__dirname, '../..');
const reuseExistingServer = process.env.SOURDAW_PERF_REUSE_SERVER === '1';
const configuredServerRoot = process.env.SOURDAW_PERF_SERVER_ROOT;
if (reuseExistingServer && configuredServerRoot === undefined) {
    throw new Error('SOURDAW_PERF_REUSE_SERVER requires SOURDAW_PERF_SERVER_ROOT to identify the measured source');
}
const serverRoot = configuredServerRoot === undefined ? harnessRoot : path.resolve(configuredServerRoot);
const cpuInfo = os.cpus();
const headless = process.env.SOURDAW_PERF_HEADLESS === '1';
const smoke = process.env.SOURDAW_PERF_SMOKE === '1';
const audioLatencyProfile = process.env.SOURDAW_PERF_AUDIO_PROFILE ?? 'lowLatency';
if (!['lowLatency', 'highCapacity'].includes(audioLatencyProfile)) {
    throw new Error('SOURDAW_PERF_AUDIO_PROFILE must be lowLatency or highCapacity');
}
const evidenceOutputDir = `test-results/mycelium-performance-${audioLatencyProfile}`;
if (reuseExistingServer && !smoke) {
    throw new Error('Campaign performance evidence must start its own measured server');
}
const readGit = (root, args) => childProcess.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const gitDirty = readGit(serverRoot, ['status', '--porcelain=v1']).length > 0;
const harnessGitDirty = readGit(harnessRoot, ['status', '--porcelain=v1']).length > 0;
if ((gitDirty || harnessGitDirty) && !smoke) {
    throw new Error('Campaign performance evidence requires clean measured-source and harness worktrees');
}
const performanceMetadata = {
    gitSha: readGit(serverRoot, ['rev-parse', 'HEAD']),
    gitDirty,
    harnessGitSha: readGit(harnessRoot, ['rev-parse', 'HEAD']),
    harnessGitDirty,
    headless,
    smoke,
    audioLatencyProfile,
    os: {
        platform: os.platform(),
        release: os.release(),
        architecture: process.arch,
        cpuModel: cpuInfo[0]?.model ?? 'unknown',
        logicalCpuCount: cpuInfo.length,
        totalMemoryBytes: os.totalmem(),
        freeMemoryBytesAtStart: os.freemem(),
    },
};

module.exports = defineConfig({
    testDir: '.',
    testMatch: 'myceliumPerformance.spec.ts',
    timeout: 600_000,
    expect: { timeout: 120_000 },
    fullyParallel: false,
    workers: 1,
    outputDir: evidenceOutputDir,
    reporter: [['line'], ['json', { outputFile: `${evidenceOutputDir}-report.json` }]],
    use: {
        baseURL: `http://127.0.0.1:${port}`,
    },
    projects: [
        {
            name: 'stable-chrome',
            metadata: { performance: performanceMetadata },
            use: { channel: 'chrome' },
        },
    ],
    webServer: {
        command: `node_modules/.bin/vite --host 127.0.0.1 --port ${port} --strictPort`,
        cwd: serverRoot,
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer,
    },
});
