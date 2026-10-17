#!/usr/bin/env node

/**
 * Yoseatsume Kakeibo - Indentation Linter
 * Ensures all code files use TAB indentation (\t, tab size = 4) and no leading space indents.
 */

import fs from 'node:fs';
import path from 'node:path';

const TARGET_DIRECTORIES = ['js', 'gas', 'test', 'scripts', 'css'];
const TARGET_INDIVIDUAL_FILES = ['sw.js', 'index.html', 'package.json', 'manifest.json', 'version.json'];
const CODE_EXTENSIONS = ['.js', '.gs', '.css', '.html', '.sh', '.json'];

function collectFiles(dir) {
	const results = [];
	if (!fs.existsSync(dir)) return results;
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== 'node_modules' && entry.name !== '.git') {
				results.push(...collectFiles(fullPath));
			}
		} else if (entry.isFile()) {
			const ext = path.extname(entry.name);
			if (CODE_EXTENSIONS.includes(ext)) {
				results.push(fullPath);
			}
		}
	}
	return results;
}

let allFiles = [...TARGET_INDIVIDUAL_FILES];
for (const dir of TARGET_DIRECTORIES) {
	allFiles.push(...collectFiles(dir));
}

// Remove duplicates and non-existent files
allFiles = Array.from(new Set(allFiles)).filter(f => fs.existsSync(f));

let errorsCount = 0;
const report = [];

for (const filePath of allFiles) {
	const content = fs.readFileSync(filePath, 'utf8');
	const lines = content.split('\n');

	lines.forEach((line, index) => {
		const lineNum = index + 1;

		// Skip empty lines
		if (line.trim().length === 0) return;

		// Check for leading spaces
		// Disallow 2 or more spaces at start of line, or space following a tab (mixed indent)
		// Exception: JSDoc continuation " *" or "\t *" is permitted
		if (/^\t* \*/.test(line)) {
			return; // Allowed JSDoc continuation
		}

		// Detect lines starting with spaces or containing mixed spaces in indent
		if (/^ +/.test(line)) {
			errorsCount++;
			report.push(`${filePath}:${lineNum} - Leading space indentation detected (Must use TAB)`);
		} else if (/^\t+ +[^\*]/.test(line)) {
			errorsCount++;
			report.push(`${filePath}:${lineNum} - Mixed TAB and Space indentation detected`);
		}
	});
}

if (errorsCount > 0) {
	console.error(`\x1b[31m[FAILED] Found ${errorsCount} indentation error(s) across ${allFiles.length} files:\x1b[0m`);
	report.slice(0, 50).forEach(err => console.error(`  ${err}`));
	if (report.length > 50) {
		console.error(`  ... and ${report.length - 50} more errors.`);
	}
	process.exit(1);
} else {
	console.log(`\x1b[32m[PASSED] All ${allFiles.length} code files strictly adhere to TAB indentation (tab size = 4).\x1b[0m`);
	process.exit(0);
}

