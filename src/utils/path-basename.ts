export function basename_from_path(path: string): string {
    const trimmed_path = path.replace(/[\\/]+$/, '');

    return trimmed_path.split(/[\\/]/).pop() || path;
}
