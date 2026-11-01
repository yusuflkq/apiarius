// `node --test tests/web/` runs this folder as one module (Node 21+ takes the path as
// a file, not a folder to search), so load every test file in it from here.
for (const file of require('fs').readdirSync(__dirname).sort()) if (file.endsWith('.test.js')) require(`./${file}`)
