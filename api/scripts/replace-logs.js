const fs = require('fs');
const glob = require('glob');

const files = glob.sync('src/**/*.ts', { cwd: __dirname + '/../', absolute: true });

for (const file of files) {
    let changed = false;
    let content = fs.readFileSync(file, 'utf8');

    if (file.includes('utils/logger.ts')) continue;
    if (file.includes('env.ts')) continue;
    if (file.includes('crypto.ts')) continue; // Generate string

    if (content.includes('console.log') || content.includes('console.error')) {
        if (!content.includes('appLogger')) {
            let relPath = file.split('/src/')[1].split('/').length > 1 ? '../'.repeat(file.split('/src/')[1].split('/').length - 1) : './';
            content = `import { appLogger } from "${relPath}utils/logger";\n` + content;
        }

        // 1 arg
        content = content.replace(/console\.log\(([^,]+?)\);/g, 'appLogger.info($1);');

        // 2 args for error
        content = content.replace(/console\.error\((["`][^"`,]+?["`]),\s*([^)]+?(?:\.message)?)\);/g, 'appLogger.error({ err: $2 }, $1);');

        // 1 arg for error (env.ts skipped, but just in case)
        content = content.replace(/console\.error\(([^,]+?)\);/g, 'appLogger.error($1);');

        changed = true;
    }

    if (changed) {
        fs.writeFileSync(file, content);
        console.log('Updated ' + file);
    }
}
