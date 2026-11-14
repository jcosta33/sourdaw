import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installedGraph, physicalChild } from '../../../dependencyPorts/jsToolingInstalled.mjs';
const repository = process.cwd(),
    graph = installedGraph(repository),
    root = mkdtempSync(join(repository, 'node_modules/.cache-electron-node26-'));
try {
    mkdirSync(join(root, 'node_modules/@types'), { recursive: true });
    for (const name of ['electron', 'undici'])
        symlinkSync(graph.packageRoot(name), join(root, 'node_modules', name), 'junction');
    const electron = graph.packageRoot('electron'),
        node = physicalChild(electron, '@types/node');
    assert.equal(node, graph.packageRoot('@types/node', '26.6.6'));
    symlinkSync(node, join(root, 'node_modules/@types/node'), 'junction');
    writeFileSync(
        join(root, 'positive.mts'),
        `
import { app, BrowserWindow, ipcMain, MessageChannelMain, type BrowserWindowConstructorOptions } from 'electron';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
const options: BrowserWindowConstructorOptions = { width: 900, height: 600, show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: '/fixture/preload.js' } };
const window = new BrowserWindow(options);
app.on('activate', () => window.show());
app.whenReady().then(() => window.loadURL('http://127.0.0.1'));
ipcMain.handle('bytes', (_event, value: Uint8Array) => Buffer.from(value));
const {port1, port2} = new MessageChannelMain();
port1.postMessage({kind: 'fixture'}, [port2]); port1.start(); port1.close();
const emitter: EventEmitter = app; void emitter;
`
    );
    writeFileSync(
        join(root, 'negative.mts'),
        "import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'; const options: BrowserWindowConstructorOptions = { webPreferences: { sandbox: 'unsafe' } }; new BrowserWindow(options); import { MessageChannelMain } from 'electron'; new MessageChannelMain().port1.postMessage({}, [42]);\n"
    );
    const args = [
        join(graph.packageRoot('typescript'), 'bin/tsc'),
        '--ignoreConfig',
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        'false',
        '--module',
        'nodenext',
        '--target',
        'esnext',
        '--lib',
        'esnext,dom',
        '--types',
        'node',
    ];
    const positive = spawnSync(process.execPath, [...args, 'positive.mts'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
    });
    assert.ifError(positive.error);
    assert.equal(positive.status, 0, positive.stdout + positive.stderr);
    const negative = spawnSync(process.execPath, [...args, 'negative.mts'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
    });
    assert.ifError(negative.error);
    assert.equal(negative.status, 1, negative.stdout + negative.stderr);
    assert.match(negative.stdout, /negative\.mts.*Type 'string' is not assignable to type 'boolean/);
    assert.match(negative.stdout, /Type 'number' is not assignable to type 'MessagePortMain'/);
    console.log('Electron real Node26 declarations and invalid sandbox option passed');
} finally {
    rmSync(root, { recursive: true, force: true });
}
