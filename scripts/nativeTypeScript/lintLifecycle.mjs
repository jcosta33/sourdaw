// ESLint emits rule and code-path listeners synchronously. Defer only release
// until that traversal returns, so every Program:exit listener retains its lease.
export const nativeLintLifecycle = {
    rules: {
        'release-snapshot': {
            meta: { type: 'problem', schema: [] },
            create(context) {
                const services = context.sourceCode.parserServices;
                if (services.hasTypeInformation === false) return {};
                if (services.hasTypeInformation !== true || typeof services.dispose !== 'function') {
                    throw new Error('Native lint requires explicit native parser snapshot services');
                }
                return {
                    'Program:exit'() {
                        queueMicrotask(() => services.dispose());
                    },
                };
            },
        },
    },
};
