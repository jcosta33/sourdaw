// Parent supplies a private HOME and explicit config inputs.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const consumerRequire = createRequire(process.argv[2]);
const installedEntry = consumerRequire.resolve('is-installed-globally');
const installedRequire = createRequire(installedEntry);
const entry = installedRequire.resolve('global-directory');
const { default: directories } = await import(pathToFileURL(entry).href);
const { default: globally } = await import(pathToFileURL(installedEntry).href);
process.stdout.write(
    JSON.stringify({ npm: directories.npm, yarn: directories.yarn, pnpm: directories.pnpm, globally }) + '\n'
);
