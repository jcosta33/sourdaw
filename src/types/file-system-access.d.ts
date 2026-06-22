/**
 * File System Access API surface that ships in Chromium browsers at runtime but
 * is absent from TypeScript's DOM lib (as of the ES2024/DOM libs this project
 * targets). These declaration merges let SampleLibrary call the picker and the
 * per-handle permission methods without `as unknown as` soundness escapes.
 *
 * Shapes follow the WICG File System Access spec:
 * https://wicg.github.io/file-system-access/
 */

/** Permission descriptor accepted by query/requestPermission. */
type FileSystemHandlePermissionDescriptor = {
    mode?: 'read' | 'readwrite';
};

/** Options accepted by Window.showDirectoryPicker. */
type DirectoryPickerOptions = {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: FileSystemHandle | string;
};

interface FileSystemHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface Window {
    showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
