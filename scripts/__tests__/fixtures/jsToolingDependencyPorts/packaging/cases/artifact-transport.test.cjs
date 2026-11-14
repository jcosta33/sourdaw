const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { packageRequire } = require('../fixtures/installed-require.cjs');
const { downloadElectronArtifactZip } = packageRequire('app-builder-lib/out/util/electronGet');
const body = Buffer.from('independent local socket artifact Ω');
const filename = 'electron-v45.3.2-darwin-arm64.zip';
async function serve(server, sockets) {
    server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return server.address().port;
}
function proxy(hits, sockets) {
    const server = http.createServer((req, res) => {
        const target = new URL(req.url);
        hits.push(target.host);
        const forwarded = http.request(target, { method: req.method, headers: req.headers }, (response) => {
            res.writeHead(response.statusCode, response.headers);
            response.pipe(res);
        });
        forwarded.on('error', (error) => res.destroy(error));
        req.pipe(forwarded);
    });
    server.on('connect', (req, client, head) => {
        hits.push(req.url);
        const target = new URL('http://' + req.url);
        const upstream = net.connect(Number(target.port), target.hostname, () => {
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head.length) upstream.write(head);
            upstream.pipe(client);
            client.pipe(upstream);
        });
        sockets.add(upstream);
        upstream.on('close', () => sockets.delete(upstream));
        upstream.on('error', (e) => client.destroy(e));
        client.on('error', () => upstream.destroy());
        client.on('close', () => upstream.destroy());
    });
    return server;
}
function options(url, cacheDir, tls) {
    return {
        artifactName: 'electron',
        version: '45.3.2',
        platformName: 'darwin',
        arch: 'arm64',
        cacheDir,
        electronDownload: {
            mirrorOptions: { resolveAssetURL: async () => url },
            checksums: {
                [filename]: createHash('sha256').update(body).digest('hex'),
            },
            downloadOptions: tls ? { https: { rejectUnauthorized: false } } : {},
        },
    };
}
test(
    'actual Fetch sockets preserve per protocol uppercase proxy precedence lowercase fallback and typed TLS',
    { timeout: 20000 },
    async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-transport-'));
        const sockets = new Set();
        const servers = [];
        const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy'];
        const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
        try {
            for (const key of keys) delete process.env[key];
            const send = (req, res) => {
                res.writeHead(200, { 'content-length': body.length });
                res.end(body);
            };
            const plain = http.createServer(send);
            const secure = https.createServer(
                {
                    key: await fs.readFile(path.join(process.env.PACKAGING_PFX_FIXTURES, 'rsa.key')),
                    cert: await fs.readFile(path.join(process.env.PACKAGING_PFX_FIXTURES, 'rsa.crt')),
                },
                send
            );
            servers.push(plain, secure);
            const plainPort = await serve(plain, sockets),
                securePort = await serve(secure, sockets);
            const a = [],
                b = [],
                low = [];
            const pa = proxy(a, sockets),
                pb = proxy(b, sockets),
                pl = proxy(low, sockets);
            servers.push(pa, pb, pl);
            const [ap, bp, lp] = [await serve(pa, sockets), await serve(pb, sockets), await serve(pl, sockets)];
            process.env.HTTP_PROXY = 'http://127.0.0.1:' + ap;
            process.env.HTTPS_PROXY = 'http://127.0.0.1:' + bp;
            process.env.http_proxy = process.env.https_proxy = 'http://127.0.0.1:' + lp;
            process.env.NO_PROXY = '*';
            const plainUrl = 'http://127.0.0.1:' + plainPort + '/artifact.zip',
                secureUrl = 'https://127.0.0.1:' + securePort + '/artifact.zip';
            assert.deepEqual(
                await fs.readFile(await downloadElectronArtifactZip(options(plainUrl, path.join(dir, 'http')))),
                body
            );
            assert.deepEqual(
                await fs.readFile(await downloadElectronArtifactZip(options(secureUrl, path.join(dir, 'https'), true))),
                body
            );
            assert.deepEqual(a, ['127.0.0.1:' + plainPort]);
            assert.deepEqual(b, ['127.0.0.1:' + securePort]);
            assert.deepEqual(low, []);
            process.env.HTTP_PROXY = process.env.HTTPS_PROXY = '  ';
            await downloadElectronArtifactZip(options(plainUrl, path.join(dir, 'lower-http')));
            await downloadElectronArtifactZip(options(secureUrl, path.join(dir, 'lower-https'), true));
            assert.deepEqual(low, ['127.0.0.1:' + plainPort, '127.0.0.1:' + securePort]);
            for (const key of keys) delete process.env[key];
            await assert.rejects(
                downloadElectronArtifactZip(options(secureUrl, path.join(dir, 'strict-tls'))),
                (error) => {
                    const descriptions = [];
                    for (let e = error; e; e = e.cause) descriptions.push(String(e.code || e.message));
                    return descriptions.some((text) => /SELF_SIGNED|CERT|certificate|fetch failed/i.test(text));
                }
            );
            assert.deepEqual(
                await fs.readFile(
                    await downloadElectronArtifactZip(options(secureUrl, path.join(dir, 'direct-tls'), true))
                ),
                body
            );
        } finally {
            for (const [key, value] of Object.entries(saved))
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            for (const socket of sockets) socket.destroy();
            await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
            await fs.rm(dir, { recursive: true, force: true });
        }
    }
);
