import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { independentWave, bounded, near } from './scenarios.mjs';
export async function meydaCli(graph) {
    const require = createRequire(resolve(graph, 'package.json'));
    const directory = await mkdtemp(join(tmpdir(), 'meyda-cli-')),
        input = join(directory, 'independent.wav'),
        output = join(directory, 'features.json');
    const { header } = independentWave({ channels: 1, frames: 16 }),
        pcm = Buffer.alloc(32);
    pcm.writeInt16LE(32767, 0);
    pcm.writeInt16LE(16384, 16);
    await writeFile(input, Buffer.concat([header, pcm]));
    const entry = join(dirname(require.resolve('meyda/package.json')), 'bin/cli.js');
    const p = spawn(
        process.execPath,
        [entry, '--o=' + output, '--format=json', '--bs=8', '--hs=8', '--w=rect', input, 'rms', 'spectralCentroid'],
        { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '',
        stderr = '';
    p.stdout.on('data', (c) => (stdout += c));
    p.stderr.on('data', (c) => (stderr += c));
    const [code] = await bounded(once(p, 'close'), 'Meyda actual CLI');
    assert.equal(code, 0, stderr);
    assert.match(stdout, /2 frames analysed/);
    const features = JSON.parse(await readFile(output, 'utf8'));
    near(features.rms[0], (32767 / 32768) * Math.sqrt(1 / 8));
    near(features.rms[1], 0.5 * Math.sqrt(1 / 8));
    assert.deepEqual(features.spectralCentroid, [1.5, 1.5]);
    return features;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
    const output = await meydaCli(process.argv[2]);
    if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(output));
}
