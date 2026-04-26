export function bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    for (let index = 0; index < bytes.length; index++) {
        bin += String.fromCharCode(bytes[index]!);
    }
    return btoa(bin);
}

export function base64ToBytes(base64: string): Uint8Array {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let index = 0; index < bin.length; index++) {
        bytes[index] = bin.charCodeAt(index);
    }
    return bytes;
}
