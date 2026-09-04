export function encodeWireToolName(name: string): string {
    return name.replaceAll('.', '_');
}
