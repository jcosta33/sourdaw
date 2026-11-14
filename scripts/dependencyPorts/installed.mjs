import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';

// Resolve through the real producing parent; root hoisting can conceal an inert override.
const parents = {
    '@tensorflow/tfjs': '@spotify/basic-pitch',
    '@tensorflow/tfjs-backend-cpu': '@tensorflow/tfjs',
    '@tensorflow/tfjs-backend-webgl': '@tensorflow/tfjs',
    '@tensorflow/tfjs-data': '@tensorflow/tfjs',
    long: '@tensorflow/tfjs-core',
    seedrandom: '@tensorflow/tfjs-core',
    yargs: '@tensorflow/tfjs',
    cliui: 'yargs',
    'wrap-ansi': 'cliui',
    'string-width': 'cliui',
    'ansi-styles': 'wrap-ansi',
    fftjs: 'meyda',
    dct: 'meyda',
    wav: 'meyda',
    tslib: 'meyda',
    'stream-parser': 'wav',
    duplexer2: 'unzipper',
    unzipper: 'app-builder-lib',
    'app-builder-lib': 'electron-builder',
    pngjs: 'qrcode',
    protobufjs: 'onnxruntime-web',
};

export function packageRoot(name, requireParent) {
    let directory;
    try {
        directory = dirname(requireParent.resolve(`${name}/package.json`));
    } catch {
        directory = dirname(requireParent.resolve(name));
    }
    for (;;) {
        const metadata = join(directory, 'package.json');
        if (existsSync(metadata) && JSON.parse(readFileSync(metadata, 'utf8')).name === name) {
            return realpathSync(directory);
        }
        const parent = dirname(directory);
        if (parent === directory) throw new Error(`Cannot locate actual installed package: ${name}`);
        directory = parent;
    }
}

export function requireGraph(repository) {
    const requireRepository = createRequire(resolve(repository, 'package.json'));
    function root(name) {
        const parent = parents[name];
        const requireParent = parent ? createRequire(join(root(parent), 'package.json')) : requireRepository;
        return packageRoot(name, requireParent);
    }
    function resolveEntry(name) {
        if (isAbsolute(name)) return requireRepository.resolve(name);
        const parent = parents[name];
        const requireParent = parent ? createRequire(join(root(parent), 'package.json')) : requireRepository;
        return requireParent.resolve(name);
    }
    function load(name) {
        return requireRepository(resolveEntry(name));
    }
    load.resolve = resolveEntry;
    load.root = root;
    return load;
}
