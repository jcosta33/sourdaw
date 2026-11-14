const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { requireGraph } = require('../../../dependencyPorts/installed.mjs');
const contracts = require('./tensorflow-behavior.cjs');
const installed = requireGraph(process.argv[2]);
const esbuild = installed('esbuild');

async function main() {
    const core = installed('@tensorflow/tfjs-core');
    const tf = installed('@tensorflow/tfjs');
    for (const api of [core, tf]) {
        contracts.hashContract(api);
        await contracts.fetchContract(api);
        contracts.missingNativeFetchContract(api);
    }
    await contracts.dataContract(installed('@tensorflow/tfjs-data'), core);
    for (const [name, prefix] of [
        ['@tensorflow/tfjs-core', 'tf-core'],
        ['@tensorflow/tfjs', 'tf'],
    ]) {
        const root = installed.root(name);
        for (const suffix of ['.min.js', '.es2017.min.js', '.fesm.min.js', 'mini']) {
            const file = path.join(root, suffix === 'mini' ? 'dist/miniprogram/index.js' : `dist/${prefix}${suffix}`);
            let api;
            if (suffix.includes('fesm')) {
                const code = esbuild.transformSync(fs.readFileSync(file, 'utf8'), { format: 'cjs', loader: 'js' }).code;
                const loaded = new module.constructor(file, module);
                loaded.filename = file;
                loaded.paths = module.paths;
                loaded._compile(code, file);
                api = loaded.exports;
            } else api = require(file);
            contracts.hashContract(api);
            await contracts.fetchContract(api);
        }
    }
    const { terminalContract } = await import('./terminal.mjs');
    terminalContract({
        stringWidth: installed('string-width').default,
        wrapAnsi: installed('wrap-ansi').default,
        cliui: installed('cliui'),
        yargs: installed('yargs'),
        ansiStyles: installed('ansi-styles').default,
    });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-native-fetch-'));
    try {
        // Bundle the actual deep ESM implementation, including its injection exports.
        const entry = path.join(directory, 'entry.mjs');
        fs.writeFileSync(
            entry,
            `import ${JSON.stringify(path.join(installed.root('@tensorflow/tfjs-core'), 'dist/index.js'))};\nexport {PlatformNode,setSystemFetch,getSystemFetch,resetSystemFetch} from ${JSON.stringify(path.join(installed.root('@tensorflow/tfjs-core'), 'dist/platforms/platform_node.js'))};`
        );
        const code = esbuild.buildSync({
            entryPoints: [entry],
            bundle: true,
            platform: 'node',
            format: 'cjs',
            mainFields: ['module', 'main'],
            write: false,
        }).outputFiles[0].text;
        const loaded = new module.constructor(entry, module);
        loaded.filename = entry;
        loaded.paths = module.paths;
        loaded._compile(code, entry);
        const { PlatformNode, setSystemFetch, getSystemFetch, resetSystemFetch } = loaded.exports;
        const original = global.fetch;
        try {
            delete global.fetch;
            const platform = new PlatformNode();
            const init = { method: 'POST' };
            const fetch = (url, options) => {
                assert.equal(url, 'https://example.invalid/a');
                assert.equal(options, init);
                return Promise.resolve('injected');
            };
            setSystemFetch(fetch);
            assert.equal(getSystemFetch(), fetch);
            assert.equal(await platform.fetch('https://example.invalid/a', init), 'injected');
            resetSystemFetch();
            assert.equal(getSystemFetch(), null);
            assert.throws(() => platform.fetch('x'), /requires native fetch/);
        } finally {
            global.fetch = original;
        }
        const cli = path.join(installed.root('@tensorflow/tfjs'), 'dist/tools/custom_module/cli.js');
        const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8' });
        assert.equal(run(['--help']).status, 0);
        const absent = run([]);
        assert.equal(absent.status, 1);
        assert.match(absent.stderr, /Missing required argument/);
        const config = path.join(directory, '音-🎹.json');
        fs.writeFileSync(
            config,
            JSON.stringify({
                outputPath: path.join(directory, 'output'),
                models: [],
                backends: ['cpu'],
                kernels: ['Add', 'MatMul'],
            })
        );
        const generated = run(['--config', config]);
        assert.equal(generated.status, 0, generated.stderr);
        for (const name of ['custom_tfjs.js', 'custom_tfjs_core.js']) {
            assert.deepEqual(
                fs.readFileSync(path.join(directory, 'output', name)),
                fs.readFileSync(path.join(__dirname, name + '.txt'))
            );
        }
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
    console.log('TensorFlow contracts passed');
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
