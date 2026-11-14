exports.esm = require('./esm.js').value;
exports.cjs = require('./cjs.js').value;
try {
    require('./malformed.js');
} catch (error) {
    exports.malformed = error.name;
}
