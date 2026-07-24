declare module '@tauri-apps/api/core' {
    /**
     * Mirrors the upstream `InvokeArgs` union. An `ArrayBuffer`/`Uint8Array`
     * message is what selects Tauri's raw `application/octet-stream` body
     * instead of JSON — see `writeFileBytes` in `src/utils/tauriBridge.ts`.
     */
    export type InvokeArgs = Record<string, unknown> | number[] | ArrayBuffer | Uint8Array;

    export type InvokeOptions = {
        headers: HeadersInit;
    };

    export function invoke(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<unknown>;
}
