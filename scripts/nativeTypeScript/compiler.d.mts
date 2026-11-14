export type NativeTypeScriptIdentity = {
    upstreamVersion: string;
    upstreamCommit: string;
    upstreamTree: string;
    patchSha256: string;
    protocol: string;
    goVersion: string;
    goModSha256: string;
    goSumSha256: string;
    officialRepository: string;
    goFiles: readonly { filename: string; os: string; arch: string; sha256: string }[];
};
export declare function nativeTypeScriptIdentity(): NativeTypeScriptIdentity;
export declare function sha256(bytes: string | Uint8Array): string;
export declare function nativeTypeScriptCacheRoot(): string;
export declare function nativeTypeScriptCacheDirectory(identity?: NativeTypeScriptIdentity): string;
export declare function getPreparedNativeTypeScriptPath(): string;
export declare function ensurePrivateNativeTypeScriptDirectory(path: string): string;
