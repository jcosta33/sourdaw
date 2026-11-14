'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
assert.ok(process.env.PACKAGING_REQUIRE_FROM, 'set integrated lane package.json');
assert.ok(process.env.PACKAGING_PFX_FIXTURES, 'set independently generated OpenSSL fixture directory');
const laneRequire = require('../fixtures/installed-require.cjs').packageRequire;
const root = path.dirname(laneRequire.resolve('app-builder-lib/package.json'));
const appRequire = createRequire(path.join(root, 'package.json'));
const pkijs = appRequire('pkijs');
const bytes = (buffer) => Uint8Array.from(buffer).buffer;
const roots = [root];
const fixtureDirectory = process.env.PACKAGING_PFX_FIXTURES;
const password = 'fixture-password';
const positives = [
    'PBE-SHA1-3DES',
    'PBE-SHA1-2DES',
    'PBE-SHA1-RC2-128',
    'PBE-SHA1-RC2-40',
    'AES-128-CBC',
    'AES-192-CBC',
    'AES-256-CBC',
    'CMS-RSA',
    'CMS-RSA-PSS',
    'CMS-prime256v1',
    'CMS-secp384r1',
    'CMS-secp521r1',
    'pbes2-sha1-safe',
];
function observe(appRoot, file, suppliedPassword = password) {
    const child = spawnSync(
        process.execPath,
        [path.join(__dirname, '../fixtures/pfx-worker.cjs'), appRoot, file, suppliedPassword],
        {
            encoding: 'utf8',
            timeout: 15000,
            env: { ...process.env, FORCE_COLOR: '0' },
        }
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    const line = child.stdout.split('\n').find((line) => line.startsWith('PFX_FIXTURE:'));
    assert.ok(line, child.stdout + child.stderr);
    const value = JSON.parse(line.slice('PFX_FIXTURE:'.length));
    assert.deepEqual(value.blocked, [], 'certificate read must remain local and never spawn');
    return value;
}
for (const name of positives)
    test('independent OpenSSL native certificate output: ' + name, () => {
        const file = path.join(fixtureDirectory, name + '.pfx');
        const after = observe(root, file);
        assert.equal(after.ok, true, JSON.stringify(after));
        assert.deepEqual(after.value, {
            commonName: 'Sourdaw Fixture',
            bloodyMicrosoftSubjectDn: 'CN=Sourdaw Fixture,O=Fixture Company',
        });
        if (!name.startsWith('CMS-'))
            for (const appRoot of roots) assert.equal(observe(appRoot, file, 'wrong fixture password').ok, false);
    });
test('real PFX MAC and CMS signature tampering remain rejected by the actual native consumer', async () => {
    for (const name of ['PBE-SHA1-RC2-40', 'AES-256-CBC', 'CMS-RSA', 'CMS-RSA-PSS', 'CMS-secp384r1']) {
        const file = path.join(fixtureDirectory, name + '.pfx');
        const pfx = pkijs.PFX.fromBER(bytes(await fs.readFile(file)));
        if (pfx.macData) pfx.macData.mac.digest.valueBlock.valueHexView[0] ^= 1;
        else {
            const cms = new pkijs.SignedData({ schema: pfx.authSafe.content });
            cms.signerInfos[0].signature.valueBlock.valueHexView[0] ^= 1;
            pfx.authSafe.content = cms.toSchema(true);
        }
        const altered = path.join(fixtureDirectory, name + '-tampered.pfx');
        await fs.writeFile(altered, Buffer.from(pfx.toSchema().toBER(false)));
        for (const appRoot of roots) {
            const result = observe(appRoot, altered);
            assert.equal(result.ok, false, name + ' integrity was bypassed');
            if (appRoot === root)
                assert.match(
                    result.error.message,
                    /integrity|password incorrect/i,
                    'candidate must reach actual MAC or signature validation'
                );
        }
    }
});
test('valid authenticated containers with unsupported algorithm or absent certificate stay rejected', () => {
    for (const appRoot of [root]) {
        const unsupported = observe(appRoot, path.join(fixtureDirectory, 'unsupported-safe.pfx'));
        assert.equal(unsupported.ok, false);
        assert.match(
            unsupported.error.message,
            /1\.2\.3\.999/,
            'the failure must observe the authenticated unsupported cipher, not a broken outer signature'
        );
        const empty = observe(appRoot, path.join(fixtureDirectory, 'empty-safe.pfx'));
        assert.equal(empty.ok, false);
        assert.match(empty.error.message, /SafeContents/, 'retain observed empty SafeContents schema refusal');
        const noCert = observe(appRoot, path.join(fixtureDirectory, 'no-cert-safe.pfx'));
        assert.equal(noCert.ok, false);
        assert.match(noCert.error.message, /No certificates found/);
    }
});

test('actual candidate refuses absent signed content before crypto verification', async () => {
    const pfx = pkijs.PFX.fromBER(bytes(await fs.readFile(path.join(fixtureDirectory, 'CMS-RSA.pfx'))));
    const cms = new pkijs.SignedData({ schema: pfx.authSafe.content });
    delete cms.encapContentInfo.eContent;
    pfx.authSafe.content = cms.toSchema(true);
    const file = path.join(fixtureDirectory, 'CMS-absent-content.pfx');
    await fs.writeFile(file, Buffer.from(pfx.toSchema().toBER(false)));
    const result = observe(root, file);
    assert.equal(result.ok, false);
    assert.match(result.error.message, /Absent mandatory parameter 'eContent'/);
});
