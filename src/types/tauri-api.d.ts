declare module '@tauri-apps/api/core' {
    export function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}
