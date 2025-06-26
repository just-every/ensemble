import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function* walk(dir) {
    for await (const d of await fs.opendir(dir)) {
        const entry = path.join(dir, d.name);
        if (d.isDirectory()) yield* walk(entry);
        else if (d.isFile()) yield entry;
    }
}

async function fixupCjsFiles() {
    const cjsDir = path.join(__dirname, '..', 'dist', 'cjs');
    
    // First, rename all .js files to .cjs
    for await (const filePath of walk(cjsDir)) {
        if (filePath.endsWith('.js')) {
            const newPath = filePath.replace(/\.js$/, '.cjs');
            await fs.rename(filePath, newPath);
        }
    }
    
    // Then fix imports in all .cjs files
    for await (const filePath of walk(cjsDir)) {
        if (filePath.endsWith('.cjs')) {
            let content = await fs.readFile(filePath, 'utf8');
            
            // Fix relative imports to use .cjs extension
            content = content.replace(/require\(["'](\.[^"']+)\.js["']\)/g, 'require("$1.cjs")');
            
            // Fix imports from the same package
            content = content.replace(/require\(["']@just-every\/ensemble\/([^"']+)\.js["']\)/g, 'require("@just-every/ensemble/$1.cjs")');
            
            await fs.writeFile(filePath, content);
        }
    }
    
    // Update declaration file references
    for await (const filePath of walk(cjsDir)) {
        if (filePath.endsWith('.d.ts')) {
            let content = await fs.readFile(filePath, 'utf8');
            
            // Fix references to .js files in declaration files
            content = content.replace(/from ["'](\.[^"']+)\.js["']/g, 'from "$1.cjs"');
            
            await fs.writeFile(filePath, content);
        }
    }
    
    console.log('CommonJS files fixed up successfully');
}

fixupCjsFiles().catch(console.error);