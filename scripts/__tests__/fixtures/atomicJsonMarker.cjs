const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { dirname, basename, join } = require('node:path');

function publishJson(markerPath, value, filesystem = fs) {
    const temporaryPath = join(dirname(markerPath), `.${basename(markerPath)}.${randomUUID()}.tmp`);
    const contents = JSON.stringify(value);

    filesystem.writeFileSync(temporaryPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    filesystem.renameSync(temporaryPath, markerPath);
}

module.exports = { publishJson };
