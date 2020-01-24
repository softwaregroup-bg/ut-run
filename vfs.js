const fs = require('fs');
module.exports = (require.utCompile && require.utCompile.vfs) || {
    compile: () => false,
    readdir: (path, cb) => fs.readdir(path, cb),
    isFile: fileName => fs.statSync(fileName).isFile(),
    readFileSync: fileName => fs.readFileSync(fileName)
};
