import { join } from 'node:path';
if (process.env.SOURDAW_DEBUG_DIR) {
    process.env.DEBUG_FILE = join(process.env.SOURDAW_DEBUG_DIR, `${process.pid}.log`);
}
