type WriteDawProjectFileInput = {
    bytes: Uint8Array;
    filePath: string;
};

type WriteDawProjectFileOutput = Promise<void>;

export async function writeDawProjectFile({ bytes, filePath }: WriteDawProjectFileInput): WriteDawProjectFileOutput {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(filePath, bytes);
}
