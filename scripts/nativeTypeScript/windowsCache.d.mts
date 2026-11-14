export declare function windowsPrivateCache(request: {
    operation: 'default-root' | 'create' | 'verify';
    root?: string;
    path?: string;
    entries?: readonly { path: string; kind: 'directory' | 'file' | 'executable' }[];
}): string;
