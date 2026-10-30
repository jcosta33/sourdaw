'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function verify(state, sourceRoot) {
    assert.equal(state.role, 'worker');
    assert.equal(state.validHostedTargetObservation, true);
    assert.equal(state.targetSeen, true);
    assert.equal(state.complete, true);
    assert.equal(state.exitObserved, true);
    assert.equal(state.canaryOverride, false);
    assert.equal(state.sourceRoot, sourceRoot);
    assert.equal(state.scopeRoot, sourceRoot);
    assert.equal(state.observedTarget.relativeFile, 'tests/e2e/persistedClipEditAcceptance.spec.ts');
    assert.equal(state.observedTarget.sourceRelativeFile, 'tests/e2e/persistedClipEditAcceptance.spec.ts');
    assert.equal(state.observedTarget.file, path.join(sourceRoot, 'tests/e2e/persistedClipEditAcceptance.spec.ts'));
    assert.equal(
        state.observedTarget.title,
        'persisted clip edits replay exact owners and source material through real same-tab hydration'
    );
    assert.equal(state.observedTarget.project, 'chromium-dev');
    assert.equal(state.observedTarget.scopeRoot, sourceRoot);
    assert.deepEqual(
        state.packageBindings.map((entry) => [entry.name, entry.version]),
        [
            ['@playwright/test', '1.64.1'],
            ['playwright', '1.64.1'],
            ['playwright-core', '1.64.1'],
        ]
    );
    assert.ok(state.connections.length > 0);
    assert.equal(state.connectionsClosed, state.connections.length);
    assert.ok(state.connections.every((entry) => entry.admitted === true && entry.browserVersion === '156.0.8078.4'));
    for (const key of ['droppedRecords', 'droppedBytes', 'droppedConnections', 'errors'])
        assert.equal(state.counts[key], 0);
}

function main(root, directory) {
    const sourceRoot = fs.realpathSync(root);
    const files = fs.readdirSync(directory).filter((name) => /^control-\d+\.json$/.test(name));
    let targets = 0;
    for (const file of files) {
        const fullPath = path.join(directory, file);
        assert.ok(fs.statSync(fullPath).size <= 1024 * 1024 + 32768);
        const state = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        if (!state.targetSeen) continue;
        verify(state, sourceRoot);
        targets += 1;
    }
    assert.ok(targets > 0, 'No complete hosted target worker observation');
    console.log(`Verified ${targets} hosted target worker observation(s)`);
}
if (require.main === module) main(process.argv[2], process.argv[3]);
module.exports = { verify };
