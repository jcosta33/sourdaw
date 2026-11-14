'use strict';
// Builds test certificates with the published PKIJS API, never production keys.
const { test } = require('node:test');
const { packageRequire } = require('../fixtures/installed-require.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { createRequire } = require('node:module');
const appRequire = createRequire(packageRequire.resolve('app-builder-lib/package.json'));
const pkijs = appRequire('pkijs');
const asn1js = appRequire('asn1js');
const { readCertInfo } = packageRequire('app-builder-lib/out/codeSign/certInfo');
const fixtureEngine = new pkijs.CryptoEngine({
    name: 'fixture-node',
    crypto: webcrypto,
    subtle: webcrypto.subtle,
});
function arrayBuffer(bytes) {
    return Uint8Array.from(bytes).buffer;
}
const password = 'fixture literal password Ω';
const passwordBytes = arrayBuffer(Buffer.from(password, 'utf8'));
async function certificate(keys, commonName, codeSigning) {
    const subject = new pkijs.RelativeDistinguishedNames({
        typesAndValues: [
            new pkijs.AttributeTypeAndValue({
                type: '2.5.4.3',
                value: new asn1js.Utf8String({ value: commonName }),
            }),
            new pkijs.AttributeTypeAndValue({
                type: '2.5.4.10',
                value: new asn1js.Utf8String({ value: 'Fixture, Company' }),
            }),
        ],
    });
    const cert = new pkijs.Certificate({
        version: 2,
        serialNumber: new asn1js.Integer({ value: codeSigning ? 2 : 1 }),
        issuer: subject,
        subject,
        notBefore: new pkijs.Time({
            type: 0,
            value: new Date('2024-01-01T00:00:00Z'),
        }),
        notAfter: new pkijs.Time({
            type: 0,
            value: new Date('2034-01-01T00:00:00Z'),
        }),
    });
    await cert.subjectPublicKeyInfo.importKey(keys.publicKey, fixtureEngine);
    cert.extensions = [
        new pkijs.Extension({
            extnID: pkijs.id_ExtKeyUsage,
            extnValue: new pkijs.ExtKeyUsage({
                keyPurposes: [codeSigning ? '1.3.6.1.5.5.7.3.3' : '1.3.6.1.5.5.7.3.1'],
            })
                .toSchema()
                .toBER(false),
        }),
    ];
    await cert.sign(keys.privateKey, 'SHA-256', fixtureEngine);
    return cert;
}
async function pfxFixture(certs, hmacHashAlgorithm = 'SHA-256', aesLength = 256) {
    const safe = new pkijs.SafeContents({
        safeBags: certs.map(
            (cert) =>
                new pkijs.SafeBag({
                    bagId: '1.2.840.113549.1.12.10.1.3',
                    bagValue: new pkijs.CertBag({ parsedValue: cert }),
                })
        ),
    });
    const encrypted = new pkijs.EncryptedData();
    await encrypted.encrypt(
        {
            password: passwordBytes,
            contentEncryptionAlgorithm: { name: 'AES-CBC', length: aesLength },
            hmacHashAlgorithm: 'SHA-256',
            iterationCount: 2048,
            contentToEncrypt: safe.toSchema().toBER(false),
        },
        fixtureEngine
    );
    const authenticatedSafe = new pkijs.AuthenticatedSafe({
        safeContents: [
            new pkijs.ContentInfo({
                contentType: pkijs.id_ContentType_EncryptedData,
                content: encrypted.toSchema(),
            }),
        ],
    });
    const pfx = new pkijs.PFX({
        parsedValue: { integrityMode: 0, authenticatedSafe },
    });
    await pfx.makeInternalValues(
        {
            password: passwordBytes,
            iterations: 2048,
            pbkdf2HashAlgorithm: hmacHashAlgorithm,
            hmacHashAlgorithm,
        },
        fixtureEngine
    );
    return pfx;
}
async function withDirectory(run) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'packaging-pfx-'));
    try {
        return await run(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}
test(
    'native provider reads actual encrypted PFX and preserves code-signing EKU selection and DN',
    { timeout: 30000 },
    async () =>
        withDirectory(async (dir) => {
            const keys = await webcrypto.subtle.generateKey(
                {
                    name: 'RSASSA-PKCS1-v1_5',
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: 'SHA-256',
                },
                true,
                ['sign', 'verify']
            );
            const nonSigning = await certificate(keys, 'TLS decoy', false);
            const signing = await certificate(keys, 'Sourdaw Fixture Ω', true);
            for (const [hash, aesLength] of [
                ['SHA-1', 128],
                ['SHA-256', 192],
                ['SHA-384', 256],
                ['SHA-512', 256],
            ]) {
                const pfx = await pfxFixture([nonSigning, signing], hash, aesLength);
                const file = path.join(dir, hash + '.pfx');
                await fs.writeFile(file, Buffer.from(pfx.toSchema().toBER(false)));
                assert.deepEqual(await readCertInfo(file, password), {
                    commonName: 'Sourdaw Fixture Ω',
                    bloodyMicrosoftSubjectDn: 'CN=Sourdaw Fixture Ω,O="Fixture, Company"',
                });
                await assert.rejects(readCertInfo(file, 'wrong password'), /password incorrect/);
                pfx.macData.mac.digest.valueBlock.valueHexView[0] ^= 1;
                await fs.writeFile(file, Buffer.from(pfx.toSchema().toBER(false)));
                await assert.rejects(readCertInfo(file, password), /password incorrect|integrity/i);
            }
            const noEku = await pfxFixture([nonSigning]);
            const file = path.join(dir, 'tls-only.pfx');
            await fs.writeFile(file, Buffer.from(noEku.toSchema().toBER(false)));
            await assert.rejects(readCertInfo(file, password), /No certificate with ExtKeyUsageCodeSigning/);
            await fs.writeFile(file, Buffer.from([0x30, 0x82, 0xff]));
            await assert.rejects(readCertInfo(file, password), /invalid ASN.1|DER/);
        })
);
