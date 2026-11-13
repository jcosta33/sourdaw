type ArgumentSummary = { operation: string; arguments: string[]; omitted: number };
/** Retain bounded invocation arguments while redacting commit-message values. */
export function checkpointArguments(args: string[]): ArgumentSummary {
    const result: ArgumentSummary = { operation: args[0] ?? '', arguments: [], omitted: 0 };
    let remainingBytes = 16 * 1024;
    let pathspecs = false;
    let skipMessage = false;
    for (const original of args.slice(1)) {
        let argument = original;
        if (skipMessage) {
            argument = '[redacted]';
            skipMessage = false;
            result.omitted++;
        } else if (!pathspecs && args[0] === 'commit') {
            if (argument === '--message') {
                skipMessage = true;
            } else if (argument.startsWith('--message=')) {
                argument = '--message=[redacted]';
                result.omitted++;
            } else if (/^-[^-]*m/.test(argument)) {
                const message = argument.indexOf('m');
                if (message === argument.length - 1) {
                    skipMessage = true;
                } else {
                    argument = `${argument.slice(0, message + 1)}[redacted]`;
                    result.omitted++;
                }
            }
        }
        if (argument === '--') {
            pathspecs = true;
        }
        const size = Buffer.byteLength(argument);
        if (result.arguments.length >= 128 || size > 512 || size > remainingBytes) {
            result.omitted++;
            continue;
        }
        remainingBytes -= size;
        result.arguments.push(argument);
    }
    return result;
}
