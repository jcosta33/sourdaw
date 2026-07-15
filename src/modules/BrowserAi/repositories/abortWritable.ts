export async function abortWritable(writable: FileSystemWritableFileStream): Promise<void> {
    try {
        await writable.abort();
    } catch {
        // Preserve the original write failure.
    }
}
