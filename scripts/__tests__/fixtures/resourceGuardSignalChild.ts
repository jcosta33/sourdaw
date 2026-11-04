import { randomUUID } from 'node:crypto';
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const suppliedRoot = process.argv[2];
const stagedAcknowledgement = process.argv[3];
if (suppliedRoot === undefined) {
    throw new Error('signal child requires a fixture root');
}
const root = suppliedRoot;
const tempDirectory = tmpdir();
function publish(name: string, value: Record<string, unknown>): void {
    const path = join(root, `${name}.json`);
    const pending = `${path}.${randomUUID()}.pending`;
    const complete = () => {
        writeFileSync(pending, JSON.stringify(value));
        renameSync(pending, path);
    };
    if (stagedAcknowledgement === name) {
        writeFileSync(pending, '{');
        writeFileSync(join(root, 'publication-staged'), name);
        const timer = setInterval(() => {
            if (existsSync(join(root, 'admit-publication'))) {
                clearInterval(timer);
                complete();
            }
        }, 20);
        return;
    }
    complete();
}
process.on('SIGTERM', () => publish('first-term', { pid: process.pid, tempExists: existsSync(tempDirectory) }));
publish('ready', { pid: process.pid, tmp: tempDirectory });
setInterval(() => {}, 1_000);
