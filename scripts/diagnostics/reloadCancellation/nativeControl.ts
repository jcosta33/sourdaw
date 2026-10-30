import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// The traced Node parent waits for its own Node child. No reporter buffering supplies the oracle.
const [mode, receipt] = process.argv.slice(2);
if (!receipt || !['exit37', 'trap'].includes(mode ?? '')) throw new Error('Invalid native control');
const source = mode === 'exit37' ? 'process.exit(37)' : 'process.kill(process.pid,"SIGTRAP")';
const child = spawn(process.execPath, ['-e', source], { stdio: 'ignore' });
const pid = child.pid;
child.once('error', (error) => {
    throw error;
});
child.once('close', (code, signal) => {
    writeFileSync(receipt, `${JSON.stringify({ pid, code, signal })}\n`, { flag: 'wx' });
});
