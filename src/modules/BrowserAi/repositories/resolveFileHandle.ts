type ResolveFileHandleInput = {
    opfsRoot: FileSystemDirectoryHandle;
    relativePath: string;
    create: boolean;
};

export async function resolveFileHandle({
    opfsRoot,
    relativePath,
    create,
}: ResolveFileHandleInput): Promise<FileSystemFileHandle> {
    const parts = relativePath.split('/');
    const fileName = parts.pop()!;
    let dir = opfsRoot;
    for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir.getFileHandle(fileName, { create });
}
