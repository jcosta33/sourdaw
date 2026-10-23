export function readHardwareMappingsFile(file: File): Promise<string> {
    return file.text();
}
