'use strict';
const { test } = require('node:test');
const { packageRequire } = require('../fixtures/installed-require.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const appRequire = createRequire(packageRequire.resolve('app-builder-lib/package.json'));
packageRequire('app-builder-lib');
const { NtExecutable, NtExecutableResource, Resource } = appRequire('resedit');
const { editWindowsResources } = packageRequire('app-builder-lib/out/util/resEdit');
const { addWinAsarIntegrity } = packageRequire('app-builder-lib/out/electron/electronWin');
const { savePlistFile, parsePlistFile } = packageRequire('app-builder-lib/out/util/plist');
const { AsarPackager } = packageRequire('app-builder-lib/out/asar/asarUtil');
const { checkFileInArchive } = packageRequire('app-builder-lib/out/asar/asarFileChecker');
const { loadBuildYaml, buildCoreSchema } = packageRequire('builder-util/out/buildYaml');
const { getS3ContentType } = packageRequire('electron-publish/out/s3/s3UploadHelper');

async function inDirectory(run) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'packaging-values-'));
    try {
        return await run(directory);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}
function iconFixture() {
    const icon = Buffer.alloc(70);
    icon.writeUInt16LE(1, 2);
    icon.writeUInt16LE(1, 4);
    icon[6] = 1;
    icon[7] = 1;
    icon.writeUInt16LE(1, 10);
    icon.writeUInt16LE(32, 12);
    icon.writeUInt32LE(48, 14);
    icon.writeUInt32LE(22, 18);
    icon.writeUInt32LE(40, 22);
    icon.writeInt32LE(1, 26);
    icon.writeInt32LE(2, 30);
    icon.writeUInt16LE(1, 34);
    icon.writeUInt16LE(32, 36);
    icon.writeUInt32LE(4, 42);
    icon.set([0x29, 0x81, 0xd3, 0xff], 62);
    return icon;
}
function resourceBytes(entries, type, id) {
    const entry = entries.find((entry) => entry.type === type && entry.id === id);
    assert.ok(entry, 'required resource ' + type + '/' + id + ' must exist');
    return Buffer.from(entry.bin);
}
test('real PE edit preserves x64, Unicode version data, icon bytes, manifest and ASAR resource', async () =>
    inDirectory(async (directory) => {
        const file = path.join(directory, 'Sourdaw.exe');
        const iconPath = path.join(directory, 'fixture.ico');
        const executable = NtExecutable.createEmpty(false, false);
        const resources = NtExecutableResource.from(executable);
        const version = Resource.VersionInfo.createEmpty();
        version.lang = 1033;
        version.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: 'Before' });
        version.outputToResourceEntries(resources.entries);
        resources.entries.push({
            type: 24,
            id: 1,
            lang: 1033,
            codepage: 1200,
            bin: Buffer.from(
                '<assembly><trustInfo><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo></assembly>'
            ),
        });
        resources.outputResource(executable);
        await fs.writeFile(file, Buffer.from(executable.generate()));
        await fs.writeFile(iconPath, iconFixture());
        await editWindowsResources({
            file,
            iconPath,
            fileVersion: '3.2.1',
            productVersion: '3.2.1.9',
            versionStrings: {
                ProductName: 'Sourdaw Ω & 音楽',
                CompanyName: 'Fixture Company',
                FileDescription: 'Audio editor',
            },
            requestedExecutionLevel: 'requireAdministrator',
        });
        const expectedHash = createHash('sha256').update('known archive header').digest('hex');
        await addWinAsarIntegrity(file, {
            'resources/app.asar': { algorithm: 'SHA256', hash: expectedHash },
        });
        const parsed = NtExecutable.from(await fs.readFile(file));
        assert.equal(parsed.is32bit(), false);
        const entries = NtExecutableResource.from(parsed).entries;
        const versions = Resource.VersionInfo.fromEntries(entries);
        assert.equal(versions.length, 1);
        const strings = versions[0].getStringValues({ lang: 1033, codepage: 1200 });
        assert.equal(strings.ProductName, 'Sourdaw Ω & 音楽');
        assert.equal(strings.FileVersion, '3.2.1');
        assert.match(resourceBytes(entries, 24, 1).toString('utf8'), /level="requireAdministrator"/);
        const groups = Resource.IconGroupEntry.fromEntries(entries);
        assert.equal(groups.length, 1);
        const icons = groups[0].getIconItemsFromEntries(entries);
        assert.equal(icons.length, 1);
        assert.deepEqual(Buffer.from(icons[0].pixels), Buffer.from([0x29, 0x81, 0xd3, 0xff]));
        assert.deepEqual(JSON.parse(resourceBytes(entries, 'INTEGRITY', 'ELECTRONASAR').toString('utf8')), [
            { file: 'resources\\app.asar', alg: 'SHA256', value: expectedHash },
        ]);
        const corrupt = path.join(directory, 'corrupt.exe');
        const invalidBytes = Buffer.from('MZ truncated PE fixture');
        await fs.writeFile(corrupt, invalidBytes);
        await assert.rejects(
            editWindowsResources({
                file: corrupt,
                fileVersion: '1.0.0',
                productVersion: '1.0.0',
                versionStrings: {},
            })
        );
        assert.deepEqual(await fs.readFile(corrupt), invalidBytes);
    }));

test('real plist consumer preserves the application Info.plist values and rejects malformed XML', async () =>
    inDirectory(async (directory) => {
        const file = path.join(directory, 'Info.plist');
        const values = {
            CFBundleDisplayName: 'Sourdaw Ω & 音楽',
            NSHighResolutionCapable: true,
            NSMicrophoneUsageDescription: 'Record <audio> & voice',
            LSMinimumSystemVersion: '11.0',
            CFBundleDocumentTypes: [
                {
                    CFBundleTypeExtensions: ['sourdaw', 'mid', 'midi'],
                    CFBundleTypeRole: 'Editor',
                },
            ],
            ElectronAsarIntegrity: {
                Resources: { algorithm: 'SHA256', hash: 'ab'.repeat(32) },
            },
        };
        await savePlistFile(file, values);
        assert.deepEqual(await parsePlistFile(file), values);
        const xml = await fs.readFile(file, 'utf8');
        assert.match(xml, /Record &lt;audio&gt; &amp; voice/);
        await fs.writeFile(file, '<plist><dict><key>broken</key></plist>');
        await assert.rejects(parsePlistFile(file));
    }));

test('real ASAR consumer writes bytes, preserves unpacked addon and rejects absent or empty main files', async () =>
    inDirectory(async (directory) => {
        const asar = appRequire('@electron/asar');
        const packager = new AsarPackager({}, { resourcePath: directory });
        const makeFile = (name, value, unpacked = false) => ({
            path: name,
            type: 'file',
            unpacked,
            stat: { mode: 0o100644, size: Buffer.byteLength(value) },
            streamGenerator: () => Readable.from([Buffer.from(value)]),
        });
        await packager.executeElectronAsar([
            { path: 'dist', type: 'directory', unpacked: false },
            makeFile('dist/main.js', 'console.log("Ω");'),
            makeFile('dist/empty.js', ''),
            makeFile('native.node', 'fixture-native-bytes', true),
        ]);
        assert.equal(asar.extractFile(packager.outFile, 'dist/main.js').toString('utf8'), 'console.log("Ω");');
        assert.equal(asar.statFile(packager.outFile, 'native.node').unpacked, true);
        assert.equal(await fs.readFile(packager.outFile + '.unpacked/native.node', 'utf8'), 'fixture-native-bytes');
        const main = await checkFileInArchive(packager.outFile, 'dist/main.js', 'Application entry');
        assert.equal(main.size, Buffer.byteLength('console.log("Ω");'));
        await assert.rejects(
            checkFileInArchive(packager.outFile, 'dist/missing.js', 'Application entry'),
            /does not exist/
        );
        await assert.rejects(checkFileInArchive(packager.outFile, 'dist/empty.js', 'Application entry'), /size 0/);
    }));

test('real MSI template compiles with EJS seven and produces escaped values and selected branches', async () => {
    const MsiTarget = packageRequire('app-builder-lib/out/targets/MsiTarget').default;
    const target = new MsiTarget({ config: {}, platformSpecificBuildOptions: {} }, '/unused-fixture-output');
    const render = await target.projectTemplate.value;
    const options = {
        productName: 'Sourdaw Ω & 音楽',
        upgradeCode: '00000000-0000-4000-8000-000000000001',
        version: '3.2.1.9',
        manufacturer: 'Fixture & Co',
        compressionLevel: 'high',
        installationDirectoryWixName: 'Sourdaw',
        iconPath: null,
        iconId: 'FixtureIcon',
        isRunAfterFinish: false,
        isAssisted: true,
        isPerMachine: false,
        programFilesId: 'ProgramFiles64Folder',
        menuCategory: null,
        isCreateDesktopShortcut: true,
        isCreateStartMenuShortcut: false,
        dirs: '<Fragment Id="known-directory"/>',
        files: '<Component Id="known-file"/>',
    };
    const xml = render(options);
    assert.match(xml, /Name="Sourdaw Ω &amp; 音楽"/);
    assert.match(xml, /Manufacturer="Fixture &amp; Co"/);
    assert.match(xml, /ProgramFiles64Folder/);
    assert.match(xml, /<Fragment Id="known-directory"\/>/);
    assert.match(xml, /<Component Id="known-file"\/>/);
    assert.match(xml, /<Directory Id="DesktopFolder"/);
    assert.doesNotMatch(xml, /<Directory Id="ProgramMenuFolder"/);
    assert.doesNotMatch(xml, /CustomAction Id="runAfterFinish"/);
    assert.throws(() => render({}), /is not defined/);
});

test('YAML configuration values retain merge, timestamp, binary, scalar and empty semantics', () => {
    const documents = [
        'base: &base { arch: arm64, enabled: true }\nmac: { <<: *base, target: [dmg, zip] }\n',
        'timestamp: 2024-05-06T07:08:09Z\nbytes: !!binary AQID/w==\nset: !!set { apple: null, pear: null }\n',
        'a: 0b101\nb: -0x2a\nc: +0o17\nd: -0\ne: -.2\nf: .2\ng: 5e-100\nh: 1_000\n',
        '',
        ' ',
        '\n',
        '\r\n',
        '\t',
        '\ufeff',
        '# comments only\n',
        '---\n',
        '...',
    ];
    const expected = [
        { base: { arch: 'arm64', enabled: true }, mac: { arch: 'arm64', enabled: true, target: ['dmg', 'zip'] } },
        {
            timestamp: new Date('2024-05-06T07:08:09Z'),
            bytes: Uint8Array.from([1, 2, 3, 255]),
            set: { apple: null, pear: null },
        },
        { a: 5, b: -42, c: 15, d: 0, e: '-.2', f: 0.2, g: 5e-100, h: '1_000' },
        undefined,
        undefined,
        undefined,
        null,
        null,
        undefined,
        null,
        null,
        null,
    ];
    documents.forEach((source, index) => assert.deepEqual(loadBuildYaml(source), expected[index]));
    assert.deepEqual(loadBuildYaml('a: 0b101\n', { schema: buildCoreSchema }), {
        a: 5,
    });
    for (const source of ['a: 1\na: 2\n', 'a: !!js/function function(){}', 'a: 1\n---\nb: 2']) {
        assert.throws(() => loadBuildYaml(source));
    }
    assert.throws(() => loadBuildYaml('date: !!timestamp 2024-05-06', { schema: buildCoreSchema }));
});

test('real publishing MIME selection preserves package and unknown-file fallback without upload', () => {
    assert.equal(getS3ContentType('Sourdaw.dmg'), 'application/octet-stream');
    assert.equal(getS3ContentType('latest.yml'), 'text/yaml');
    assert.equal(getS3ContentType('unknown.sourdaw-fixture'), 'application/octet-stream');
});

test('real fs-extra copy/move/json retain symlinks, Promise and callback errors', async () =>
    inDirectory(async (directory) => {
        const extra = appRequire('fs-extra');
        const source = path.join(directory, 'copy-source');
        const copied = path.join(directory, 'copy-target');
        await extra.ensureDir(source);
        await extra.writeFile(path.join(source, 'audio.bin'), Buffer.from([7, 2, 9, 0]));
        await extra.ensureSymlink('audio.bin', path.join(source, 'audio-link'));
        await extra.copy(source, copied, { dereference: false });
        assert.deepEqual(await extra.readFile(path.join(copied, 'audio.bin')), Buffer.from([7, 2, 9, 0]));
        assert.equal(await extra.readlink(path.join(copied, 'audio-link')), 'audio.bin');
        const moved = path.join(directory, 'moved');
        await extra.move(copied, moved);
        assert.equal(await extra.pathExists(copied), false);
        assert.equal(await extra.readlink(path.join(moved, 'audio-link')), 'audio.bin');
        const json = path.join(directory, 'nested', 'manifest.json');
        await extra.outputJson(json, { name: 'Sourdaw Ω', values: [7, 2, 9] });
        const callbackValue = await new Promise((resolve, reject) =>
            extra.readJson(json, (error, value) => (error ? reject(error) : resolve(value)))
        );
        assert.deepEqual(callbackValue, { name: 'Sourdaw Ω', values: [7, 2, 9] });
        await assert.rejects(
            new Promise((resolve, reject) =>
                extra.readFile(path.join(directory, 'absent'), (error, value) =>
                    error ? reject(error) : resolve(value)
                )
            ),
            (error) => error.code === 'ENOENT'
        );
        await assert.rejects(extra.copy(source, moved, { overwrite: false, errorOnExist: true }));
    }));
