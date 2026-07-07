import { isAudioFile } from '../../models/LibraryTypes';

export async function* traverseBrowserDirectory(
    dir: FileSystemDirectoryHandle,
    parentPath: string
): AsyncIterable<{ path: string; name: string; handle: FileSystemFileHandle; mtimeMs?: number }> {
    for await (const entry of dir.values()) {
        const childPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
        if (entry.kind === 'file' && isAudioFile(entry.name)) {
            // Read last-modified so rescans can detect in-place edits (the
            // deterministic id is path-based, so a changed file keeps its id and
            // would otherwise be deduped away with stale metadata). One getFile()
            // per audio file; a file we cannot stat still yields with no mtime.
            let mtimeMs: number | undefined;
            try {
                mtimeMs = (await entry.getFile()).lastModified;
            } catch {
                mtimeMs = undefined;
            }
            yield { path: childPath, name: entry.name, handle: entry, mtimeMs };
        } else if (entry.kind === 'directory') {
            yield* traverseBrowserDirectory(entry, childPath);
        }
    }
}
