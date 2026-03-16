declare module "@tauri-apps/plugin-dialog" {
    type DialogFilter = {
        name: string;
        extensions: string[];
    };

    type OpenDialogOptions = {
        multiple?: boolean;
        directory?: boolean;
        filters?: DialogFilter[];
        defaultPath?: string;
        title?: string;
    };

    type SaveDialogOptions = {
        defaultPath?: string;
        filters?: DialogFilter[];
        title?: string;
    };

    export function open(options?: OpenDialogOptions): Promise<string | string[] | null>;
    export function save(options?: SaveDialogOptions): Promise<string | null>;
}
