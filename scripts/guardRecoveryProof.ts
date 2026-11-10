import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

function comparableRoot(root: string): string {
    try {
        return realpathSync(root);
    } catch {
        return resolve(root);
    }
}

export function sameCheckoutRoot(left: string, right: string): boolean {
    return comparableRoot(left) === comparableRoot(right);
}
