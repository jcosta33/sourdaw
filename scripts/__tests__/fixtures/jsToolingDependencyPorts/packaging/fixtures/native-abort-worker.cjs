const [root, entry, missing] = process.argv.slice(2);
delete globalThis[missing];
try {
    require(require('node:path').join(root, entry));
    process.stderr.write('Missing native global was accepted');
    process.exitCode = 1;
} catch (error) {
    if (!error.message.includes('readable-stream requires native AbortController and AbortSignal')) {
        process.stderr.write(error.stack);
        process.exitCode = 2;
    } else process.stdout.write('MISSING_NATIVE_REFUSED\n');
}
