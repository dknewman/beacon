// Metro runs with apps/mobile as its cwd; delegate to the monorepo root config
// so Jest (run from the root) and Metro share one Babel setup.
module.exports = require('../../babel.config.js');
