type BrowserFileHandle = {
    getFile: () => Promise<File>;
};

type BrowserDirectoryHandle = {
    getDirectoryHandle: (name: string) => Promise<BrowserDirectoryHandle>;
    getFileHandle: (name: string) => Promise<BrowserFileHandle>;
};

type ReadBrowserLibrarySampleFileInput = {
    rootHandle: BrowserDirectoryHandle;
    relativePath: string;
};

type ReadBrowserLibrarySampleFileOutput = Promise<File>;

export async function readBrowserLibrarySampleFile({
    rootHandle,
    relativePath,
}: ReadBrowserLibrarySampleFileInput): ReadBrowserLibrarySampleFileOutput {
    const pathParts = relativePath.split('/');
    const fileName = pathParts.pop();
    if (!fileName) {
        throw new TypeError('Sample path does not name a file');
    }

    let dirHandle = rootHandle;
    for (const part of pathParts) {
        dirHandle = await dirHandle.getDirectoryHandle(part);
    }

    const fileHandle = await dirHandle.getFileHandle(fileName);
    return fileHandle.getFile();
}
