import { describe, expect, it } from 'vitest';

import { discoverHostedBodyCensus } from './hostedBodyCensus';

const GATEWAY = 'modules/AiRuntime/repositories/providerGateway.ts';
const SENDER = 'modules/AiRuntime/useCases/sendHosted.ts';
const CALLER = 'modules/AiRuntime/useCases/callSender.ts';

const gatewaySource = 'export async function runProviderGatewayRequest(): Promise<void> {}\n';
const senderBody = 'export async function sendHosted(): Promise<void> {\n    await send();\n}\n';
const callerSource = "import { sendHosted } from './sendHosted';\nexport const call = sendHosted;\n";

function censusWith(senderSource: string) {
    return discoverHostedBodyCensus({
        [GATEWAY]: gatewaySource,
        [SENDER]: senderSource,
        [CALLER]: callerSource,
    });
}

describe('discoverHostedBodyCensus', () => {
    // Red when the census stops reading the import form: the sender is no transport and its caller is unreached.
    it.each([
        [
            'a single-quoted dynamic import',
            `const { runProviderGatewayRequest: send } = await import('../repositories/providerGateway');\n${senderBody}`,
        ],
        [
            'a double-quoted dynamic import',
            `const { runProviderGatewayRequest: send } = await import("../repositories/providerGateway");\n${senderBody}`,
        ],
        [
            'a template-literal dynamic import',
            `const { runProviderGatewayRequest: send } = await import(\`../repositories/providerGateway\`);\n${senderBody}`,
        ],
        [
            'an aliased destructured gateway import',
            `const { runProviderGatewayRequest: dispatch } = await import('../repositories/providerGateway');\n${senderBody}`,
        ],
        [
            'an aliased static import',
            `import { runProviderGatewayRequest as send } from '../repositories/providerGateway';\n${senderBody}`,
        ],
        [
            'a double-quoted static import',
            `import { runProviderGatewayRequest as send } from "../repositories/providerGateway";\n${senderBody}`,
        ],
        [
            'a template-literal static import with no whitespace after import',
            `import{runProviderGatewayRequest as send}from\`../repositories/providerGateway\`;\n${senderBody}`,
        ],
    ])('finds the transport behind %s and the module that imports it', (_form, senderSource) => {
        const census = censusWith(senderSource);

        expect(census.transports).toContain(SENDER);
        expect(census.modules).toContain(CALLER);
        expect(census.reaches(CALLER, SENDER)).toBe(true);
    });

    it('reaches a module that imports another through a double-quoted or template-literal specifier', () => {
        const census = discoverHostedBodyCensus({
            [GATEWAY]: gatewaySource,
            [SENDER]: `import { runProviderGatewayRequest } from "../repositories/providerGateway";\n${senderBody}`,
            [CALLER]: 'export const call = () => import(`./sendHosted`);\n',
        });

        expect(census.reaches(CALLER, SENDER)).toBe(true);
    });

    it('does not treat a comment or a string naming the gateway as a transport', () => {
        const census = censusWith(
            [
                '// runProviderGatewayRequest(body) is called by the repository, not here.',
                'const note = "runProviderGatewayRequest(";',
                "const other = 'import { runProviderGatewayRequest } from x';",
                senderBody,
            ].join('\n')
        );

        expect(census.transports).toEqual([GATEWAY]);
        expect(census.modules).not.toContain(CALLER);
    });

    it('does not treat a type-only import of the gateway function as a transport', () => {
        const census = censusWith(
            `import type { runProviderGatewayRequest as send } from '../repositories/providerGateway';\n${senderBody}`
        );

        expect(census.transports).toEqual([GATEWAY]);
    });

    it('still treats a fetch against a runtime base_url as a transport', () => {
        const census = censusWith(
            'export const send = (runtime: { base_url: string }) => fetch(`${runtime.base_url}/v1`);\n'
        );

        expect(census.transports).toContain(SENDER);
    });
});
