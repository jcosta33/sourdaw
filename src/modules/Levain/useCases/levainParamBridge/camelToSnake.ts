export function camelToSnake(str: string): string {
    return str.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
