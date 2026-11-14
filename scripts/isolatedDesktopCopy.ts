import { cp, lstat, readdir, readlink, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

function isInside(root: string, path: string): boolean {
    const location = relative(root, path);
    return location === '' || (location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location));
}

export async function copyDesktopPayload(source: string, copy: string, mutationTarget: string): Promise<void> {
    await cp(source, copy, { recursive: true, verbatimSymlinks: true });
    if ((await lstat(copy)).isSymbolicLink()) throw new Error(`Unsafe copied root: ${copy}`);
    const root = await realpath(copy);
    const targetPath = resolve(mutationTarget);
    if (!isInside(resolve(copy), targetPath)) throw new Error(`Unsafe copied mutation target: ${mutationTarget}`);
    async function inspect(path: string): Promise<void> {
        const entry = await lstat(path);
        if (entry.isSymbolicLink()) {
            const link = await readlink(path);
            if (
                isAbsolute(link) ||
                !isInside(root, resolve(dirname(path), link)) ||
                !isInside(root, await realpath(path))
            ) {
                throw new Error(`Unsafe copied symlink: ${path}`);
            }
        } else if (entry.isDirectory()) {
            for (const name of await readdir(path)) await inspect(join(path, name));
        } else if (!entry.isFile()) {
            throw new Error(`Unexpected copied entry: ${path}`);
        }
    }
    await inspect(root);
    const target = await realpath(join(root, relative(resolve(copy), targetPath)));
    if (!isInside(root, target) || !(await lstat(target)).isFile()) {
        throw new Error(`Unsafe copied mutation target: ${mutationTarget}`);
    }
}
