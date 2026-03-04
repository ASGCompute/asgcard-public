const fs = require('fs');
const glob = require('glob');

const files = glob.sync('src/**/*.ts', { cwd: __dirname + '/../', absolute: true });

for (const file of files) {
    let changed = false;
    let content = fs.readFileSync(file, 'utf8');

    // Fix appLogger.error("msg", err) -> appLogger.error({ err }, "msg")
    const regex = /appLogger\.error\((["`].*?["`]),\s*(.*?)\)/g;
    content = content.replace(regex, (match, msg, errArg) => {
        changed = true;
        return `appLogger.error({ err: ${errArg} }, ${msg})`;
    });

    if (changed) {
        fs.writeFileSync(file, content);
        console.log('Fixed Pino args in ' + file);
    }
}
