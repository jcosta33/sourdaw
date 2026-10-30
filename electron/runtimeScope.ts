import { lstatSync, mkdirSync, realpathSync, chmodSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const setting = 'SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT';
const namespace = '.sourdaw-native-runtime-scopes-v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Only the trusted main-process environment selects a private runtime home. */
export const resolveRuntimeScope = (env: Readonly<Record<string, string | undefined>>) => {
    const requested = env[setting];
    if (requested === undefined) {
        return undefined;
    }
    const invalid = (): Error =>
        new Error(`${setting} must name an existing owned canonical UUID directory in ${namespace}`);
    if (
        requested === '' ||
        resolve(requested) !== requested ||
        basename(dirname(requested)) !== namespace ||
        !uuid.test(basename(requested))
    ) {
        throw invalid();
    }
    const root = realpathSync(requested);
    const metadata = lstatSync(requested);
    if (
        metadata.isSymbolicLink() ||
        !metadata.isDirectory() ||
        root !== requested ||
        (process.getuid !== undefined && metadata.uid !== process.getuid())
    ) {
        throw invalid();
    }
    const paths = Object.freeze({
        root,
        data: join(root, 'native', 'data'),
        private: join(root, 'native', 'data', 'private'),
        cache: join(root, 'native', 'cache'),
        ipc: join(root, 'native', 'ipc'),
        projects: join(root, 'native', 'projects'),
        scanResponses: join(root, 'native', 'data', 'private', 'scan-responses'),
    });
    const prepareDirectory = (relative: readonly string[]): string => {
        let directory = root;
        for (const segment of relative) {
            directory = join(directory, segment);
            try {
                mkdirSync(directory, { mode: 0o700 });
            } catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
                    throw error;
                }
            }
            const entry = lstatSync(directory);
            if (entry.isSymbolicLink() || !entry.isDirectory()) {
                throw invalid();
            }
            chmodSync(directory, 0o700);
        }
        return directory;
    };
    return Object.freeze({
        paths,
        environment: Object.freeze({ [setting]: root }),
        configureChromium: (app: {
            setPath: (name: 'userData' | 'sessionData' | 'logs', path: string) => void;
        }): void => {
            chmodSync(root, 0o700);
            app.setPath('userData', prepareDirectory(['chromium', 'userData']));
            app.setPath('sessionData', prepareDirectory(['chromium', 'sessionData']));
            app.setPath('logs', prepareDirectory(['logs']));
        },
    });
};
