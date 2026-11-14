import named from './barrel';
import type { Label } from './types';
const label: Label = named;
void label;
void import('./lazy');
new Worker(new URL('./worker.ts', import.meta.url));
