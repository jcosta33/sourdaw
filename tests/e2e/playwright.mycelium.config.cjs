const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { lstatSync, readFileSync, readlinkSync } = require('node:fs');
const path = require('node:path');

const { defineConfig, devices } = require('@playwright/test');

const port = 52_743;
const root = path.resolve(__dirname, '../..');
const evidencePathspec = ':(exclude)docs/evidence/mycelium-ascendant/**';
const sourceTreeHashScope = 'git-ls-files-excluding:docs/evidence/mycelium-ascendant/**';
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourceDirty =
    execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', '.', evidencePathspec], {
        cwd: root,
        encoding: 'utf8',
    }).length > 0;
const sourceFiles = execFileSync('git', ['ls-files', '-z', '--', '.', evidencePathspec], {
    cwd: root,
    encoding: 'utf8',
})
    .split('\0')
    .filter((file) => file.length > 0)
    .sort();
const sourceTreeHash = createHash('sha256');
for (const file of sourceFiles) {
    const absolutePath = path.resolve(root, file);
    sourceTreeHash.update(file);
    sourceTreeHash.update('\0');
    sourceTreeHash.update(
        lstatSync(absolutePath).isSymbolicLink() ? readlinkSync(absolutePath) : readFileSync(absolutePath)
    );
    sourceTreeHash.update('\0');
}

module.exports = defineConfig({
    metadata: {
        myceliumSourceRevision: sourceRevision,
        myceliumSourceDirty: sourceDirty,
        myceliumSourceTreeSha256: sourceTreeHash.digest('hex'),
        myceliumSourceTreeHashScope: sourceTreeHashScope,
        myceliumSourceTrackedFileCount: sourceFiles.length,
    },
    testDir: '.',
    timeout: 60_000,
    reporter: 'line',
    use: {
        baseURL: `http://127.0.0.1:${port}`,
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: `node_modules/.bin/vite --host 127.0.0.1 --port ${port} --strictPort`,
        cwd: root,
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: false,
    },
});
