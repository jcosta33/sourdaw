const path = require('node:path');
const childProcess = require('node:child_process');
const os = require('node:os');

const { defineConfig, devices } = require('@playwright/test');

const port = 52_744;
const repoRoot = path.resolve(__dirname, '../..');
const cpuInfo = os.cpus();
const headless = process.env.SOURDAW_PERF_HEADLESS === '1';
const smoke = process.env.SOURDAW_PERF_SMOKE === '1';
const audioLatencyProfile = process.env.SOURDAW_AUDIO_LATENCY_PROFILE ?? 'low-latency';
if (!['low-latency', 'high-capacity'].includes(audioLatencyProfile)) {
    throw new Error('SOURDAW_AUDIO_LATENCY_PROFILE must be low-latency or high-capacity');
}
const readGit = (args) => childProcess.execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const gitDirty = readGit(['status', '--porcelain=v1']).length > 0;
if (gitDirty && !smoke) {
    throw new Error('Campaign performance evidence requires a clean Git worktree');
}
const performanceMetadata = {
    gitSha: readGit(['rev-parse', 'HEAD']),
    gitDirty,
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
    reporter: [['line'], ['json', { outputFile: 'test-results/mycelium-performance-report.json' }]],
    use: {
        baseURL: `http://127.0.0.1:${port}`,
    },
    projects: [
        {
            name: 'stable-chrome',
            metadata: { performance: performanceMetadata },
            use: { ...devices['Desktop Chrome'], channel: 'chrome' },
        },
    ],
    webServer: {
        command: `node_modules/.bin/vite --host 127.0.0.1 --port ${port} --strictPort`,
        cwd: repoRoot,
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: false,
    },
});
