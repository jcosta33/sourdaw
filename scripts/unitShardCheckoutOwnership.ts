import { closeSync, constants, fchownSync, fstatSync, openSync, readdirSync, readlinkSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';

function within(root: string, path: string): boolean {
    const suffix = relative(root, path);
    return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix));
}

export type DirectoryPorts = {
    open: (path: string) => number;
    children: (fd: number) => { name: string; directory: boolean; symlink: boolean }[];
    metadata: (fd: number) => { directory: boolean; device: number; links: number };
    physicalPath: (fd: number) => string;
    own: (fd: number, uid: number, gid: number) => void;
    close: (fd: number) => void;
    now: () => number;
};

export function ownCheckoutDirectories(
    context: { workspace: string; uid: number; gid: number },
    ports: DirectoryPorts = {
        open: (path) => openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW),
        children: (fd) =>
            readdirSync(`/proc/self/fd/${fd}`, { withFileTypes: true }).map((entry) => ({
                name: entry.name,
                directory: entry.isDirectory(),
                symlink: entry.isSymbolicLink(),
            })),
        metadata: (fd) => {
            const stat = fstatSync(fd);
            return { directory: stat.isDirectory(), device: stat.dev, links: stat.nlink };
        },
        physicalPath: (fd) => readlinkSync(`/proc/self/fd/${fd}`),
        own: fchownSync,
        close: closeSync,
        now: Date.now,
    }
): void {
    const deadline = ports.now() + 300_000;
    const rootFd = ports.open(context.workspace);
    let device: number;
    let directories = 0;
    function visit(fd: number): void {
        const stat = ports.metadata(fd);
        if (
            !stat.directory ||
            stat.device !== device ||
            stat.links === 0 ||
            !within(context.workspace, ports.physicalPath(fd)) ||
            ++directories > 100_000 ||
            ports.now() > deadline
        ) {
            throw new Error('unit isolation directory ownership boundary unavailable');
        }
        ports.own(fd, context.uid, context.gid);
        for (const entry of ports.children(fd)) {
            if (!entry.directory || entry.symlink) {
                continue;
            }
            if (entry.name === '.' || entry.name === '..' || entry.name.includes('/')) {
                throw new Error('unit isolation directory entry is invalid');
            }
            const child = ports.open(`/proc/self/fd/${fd}/${entry.name}`);
            try {
                visit(child);
            } finally {
                ports.close(child);
            }
        }
    }
    try {
        device = ports.metadata(rootFd).device;
        visit(rootFd);
    } finally {
        ports.close(rootFd);
    }
}
