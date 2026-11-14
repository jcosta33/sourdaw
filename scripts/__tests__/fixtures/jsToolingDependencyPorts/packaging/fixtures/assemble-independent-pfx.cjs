'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
if (!process.env.PACKAGING_REQUIRE_FROM)
    throw new Error('Set PACKAGING_REQUIRE_FROM to the integrated lane package.json');
const laneRequire = require('./installed-require.cjs').packageRequire;
const appRequire = createRequire(laneRequire.resolve('app-builder-lib/package.json'));
const pkijs = appRequire('pkijs');
const asn1js = appRequire('asn1js');
const [mode, input, output] = process.argv.slice(2);
const bytes = (value) => Uint8Array.from(value).buffer;
async function main() {
    if (mode === 'cert-safe' || mode === 'empty-safe' || mode === 'no-cert-safe') {
        const safeBags = [];
        if (mode === 'cert-safe') {
            const pem = await fs.readFile(input, 'utf8');
            const der = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64');
            const certificate = pkijs.Certificate.fromBER(bytes(der));
            safeBags.push(
                new pkijs.SafeBag({
                    bagId: '1.2.840.113549.1.12.10.1.3',
                    bagValue: new pkijs.CertBag({ parsedValue: certificate }),
                })
            );
        }
        if (mode === 'no-cert-safe') {
            const pem = await fs.readFile(input, 'utf8');
            const der = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64');
            safeBags.push(
                new pkijs.SafeBag({
                    bagId: '1.2.840.113549.1.12.10.1.1',
                    bagValue: pkijs.PrivateKeyInfo.fromBER(bytes(der)),
                })
            );
        }
        const safe = new pkijs.SafeContents({ safeBags }).toSchema().toBER(false);
        const authenticatedSafe = new pkijs.AuthenticatedSafe({
            safeContents: [
                new pkijs.ContentInfo({
                    contentType: pkijs.id_ContentType_Data,
                    content: new asn1js.OctetString({ valueHex: safe }),
                }),
            ],
        });
        await fs.mkdir(output, { recursive: true });
        await fs.writeFile(path.join(output, 'safe-contents.der'), Buffer.from(safe));
        await fs.writeFile(path.join(output, 'authsafe.der'), Buffer.from(authenticatedSafe.toSchema().toBER(false)));
        return;
    }
    if (mode === 'pbes2-sha1-safe' || mode === 'unsupported-safe') {
        const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
        const iv = Uint8Array.from({ length: 16 }, (_, index) => index + 16);
        const params = new pkijs.PBES2Params({
            keyDerivationFunc: new pkijs.AlgorithmIdentifier({
                algorithmId: '1.2.840.113549.1.5.12',
                algorithmParams: new pkijs.PBKDF2Params({
                    salt: new asn1js.OctetString({ valueHex: bytes(salt) }),
                    iterationCount: 2048,
                    prf: new pkijs.AlgorithmIdentifier({
                        algorithmId: '1.2.840.113549.2.7',
                        algorithmParams: new asn1js.Null(),
                    }),
                }).toSchema(),
            }),
            encryptionScheme: new pkijs.AlgorithmIdentifier({
                algorithmId: '2.16.840.1.101.3.4.1.42',
                algorithmParams: new asn1js.OctetString({ valueHex: bytes(iv) }),
            }),
        });
        const encrypted = new pkijs.EncryptedData({
            encryptedContentInfo: new pkijs.EncryptedContentInfo({
                contentType: pkijs.id_ContentType_Data,
                contentEncryptionAlgorithm: new pkijs.AlgorithmIdentifier({
                    algorithmId: mode === 'unsupported-safe' ? '1.2.3.999' : '1.2.840.113549.1.5.13',
                    algorithmParams: params.toSchema(),
                }),
                encryptedContent: new asn1js.OctetString({
                    valueHex: bytes(await fs.readFile(input)),
                }),
            }),
        });
        const authenticatedSafe = new pkijs.AuthenticatedSafe({
            safeContents: [
                new pkijs.ContentInfo({
                    contentType: pkijs.id_ContentType_EncryptedData,
                    content: encrypted.toSchema(),
                }),
            ],
        });
        await fs.writeFile(output, Buffer.from(authenticatedSafe.toSchema().toBER(false)));
        return;
    }
    if (mode === 'wrap-cms') {
        const authSafe = pkijs.ContentInfo.fromBER(bytes(await fs.readFile(input)));
        if (authSafe.contentType !== pkijs.id_ContentType_SignedData)
            throw new Error('Expected OpenSSL CMS SignedData');
        const pfx = new pkijs.PFX({ authSafe });
        await fs.writeFile(output, Buffer.from(pfx.toSchema().toBER(false)));
        return;
    }
    throw new Error('Unknown fixture preparation mode');
}
main().catch((error) => {
    process.stderr.write(error.stack + '\n');
    process.exitCode = 1;
});
