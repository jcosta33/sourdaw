import { describe, expect, it, vi } from 'vitest';

import { resolveFileHandle } from '../resolveFileHandle';

type DirHandle = {
    getDirectoryHandle: ReturnType<typeof vi.fn>;
    getFileHandle: ReturnType<typeof vi.fn>;
    /** Map of child name → child handle created during traversal. */
    children: Record<string, DirHandle>;
};

function makeDirHandle(): DirHandle {
    const children: Record<string, DirHandle> = {};
    return {
        children,
        getDirectoryHandle: vi.fn((name: string, opts?: { create?: boolean }) => {
            if (!children[name]) {
                if (opts?.create) {
                    children[name] = makeDirHandle();
                } else {
                    return Promise.reject(new Error(`directory ${name} not found`));
                }
            }
            return Promise.resolve(children[name]);
        }),
        getFileHandle: vi.fn((name: string) => Promise.resolve({ id: `file:${name}` })),
    };
}

describe('resolveFileHandle', () => {
    it('resolves a flat path (no subdirectories) directly to the file handle', async () => {
        const root = makeDirHandle();
        const result = await resolveFileHandle({ opfsRoot: root as never, relativePath: 'model.onnx', create: false });

        expect(result).toEqual({ id: 'file:model.onnx' });
        expect(root.getDirectoryHandle).not.toHaveBeenCalled();
        expect(root.getFileHandle).toHaveBeenCalledWith('model.onnx', { create: false });
    });

    it('traverses intermediate directories before resolving the file', async () => {
        const root = makeDirHandle();

        await resolveFileHandle({
            opfsRoot: root as never,
            relativePath: 'diffusion/v2/model.onnx',
            create: true,
        });

        // Root traversed 'diffusion' with create: true.
        expect(root.getDirectoryHandle).toHaveBeenCalledWith('diffusion', { create: true });
        // The diffusion child then traversed 'v2'.
        const diffusion = root.children.diffusion!;
        expect(diffusion.getDirectoryHandle).toHaveBeenCalledWith('v2', { create: true });
        // The v2 child got 'model.onnx'.
        const v2 = diffusion.children.v2!;
        expect(v2.getFileHandle).toHaveBeenCalledWith('model.onnx', { create: true });
    });

    it('passes the create flag through to every handle call', async () => {
        const root = makeDirHandle();

        await resolveFileHandle({ opfsRoot: root as never, relativePath: 'a/b/c.bin', create: false }).catch(
            () => null
        );

        // The first call to getDirectoryHandle must pass create: false.
        expect(root.getDirectoryHandle).toHaveBeenCalledWith('a', { create: false });
    });

    it('propagates an error when an intermediate directory does not exist and create is false', async () => {
        const root = makeDirHandle();

        await expect(
            resolveFileHandle({ opfsRoot: root as never, relativePath: 'missing/file.bin', create: false })
        ).rejects.toThrow('directory missing not found');
    });

    it('handles deeply nested paths (3+ levels)', async () => {
        const root = makeDirHandle();

        await resolveFileHandle({ opfsRoot: root as never, relativePath: 'top/mid/deep/file.json', create: true });

        expect(root.getDirectoryHandle).toHaveBeenCalledWith('top', { create: true });
        const top = root.children.top!;
        expect(top.getDirectoryHandle).toHaveBeenCalledWith('mid', { create: true });
        const mid = top.children.mid!;
        expect(mid.getDirectoryHandle).toHaveBeenCalledWith('deep', { create: true });
        const deep = mid.children.deep!;
        expect(deep.getFileHandle).toHaveBeenCalledWith('file.json', { create: true });
    });

    it('creates directories on demand when create is true', async () => {
        const root = makeDirHandle();

        // With create: true, directories are auto-created — no error.
        const result = await resolveFileHandle({
            opfsRoot: root as never,
            relativePath: 'new/nested/path/file.wasm',
            create: true,
        });

        expect(result).toEqual({ id: 'file:file.wasm' });
    });
});
