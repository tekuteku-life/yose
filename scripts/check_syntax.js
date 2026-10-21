#!/usr/bin/env node

/**
 * Yoseatsume Kakeibo - Syntax Linter
 * Validates syntax across all project files:
 * 1. JavaScript files (.js) via `node -c`
 * 2. Google Apps Script files (.gs) via `vm.Script`
 * 3. JSON files (.json) via `JSON.parse`
 * 4. Mermaid diagrams in Markdown files (docs/**\/*.md) for syntax integrity and special character quoting
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const TARGET_DIRECTORIES = ['js', 'gas', 'test', 'scripts'];
const TARGET_INDIVIDUAL_FILES = ['sw.js', 'package.json', 'manifest.json', 'version.json', '.clasp.json'];

function collectFiles(dir, extensions) {
	const results = [];
	if (!fs.existsSync(dir)) return results;
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== 'node_modules' && entry.name !== '.git') {
				results.push(...collectFiles(fullPath, extensions));
			}
		} else if (entry.isFile()) {
			const ext = path.extname(entry.name);
			if (extensions.includes(ext)) {
				results.push(fullPath);
			}
		}
	}
	return results;
}

let errorsCount = 0;
const report = [];

// 1. Validate JavaScript (.js)
const jsFiles = [...TARGET_INDIVIDUAL_FILES.filter(f => f.endsWith('.js'))];
for (const dir of ['js', 'test', 'scripts']) {
	jsFiles.push(...collectFiles(dir, ['.js', '.mjs']));
}

for (const file of Array.from(new Set(jsFiles)).filter(f => fs.existsSync(f))) {
	const result = spawnSync(process.execPath, ['-c', file], { encoding: 'utf8' });
	if (result.status !== 0) {
		errorsCount++;
		report.push(`[JS SyntaxError] ${file}: ${result.stderr.trim()}`);
	}
}

// 2. Validate Google Apps Script (.gs)
const gsFiles = collectFiles('gas', ['.gs']);
for (const file of gsFiles) {
	try {
		const code = fs.readFileSync(file, 'utf8');
		new vm.Script(code, { filename: file });
	} catch (err) {
		errorsCount++;
		report.push(`[GAS SyntaxError] ${file}:${err.lineNumber || '?'}: ${err.message}`);
	}
}

// 3. Validate JSON (.json)
const jsonFiles = [...TARGET_INDIVIDUAL_FILES.filter(f => f.endsWith('.json'))];
jsonFiles.push(...collectFiles('gas', ['.json']));

for (const file of Array.from(new Set(jsonFiles)).filter(f => fs.existsSync(f))) {
	try {
		const content = fs.readFileSync(file, 'utf8');
		JSON.parse(content);
	} catch (err) {
		errorsCount++;
		report.push(`[JSON ParseError] ${file}: ${err.message}`);
	}
}

// 4. Validate Mermaid diagrams in Markdown (docs/**/*.md)
const mdFiles = collectFiles('docs', ['.md']);
for (const file of mdFiles) {
	const content = fs.readFileSync(file, 'utf8');
	const lines = content.split('\n');
	let insideMermaid = false;
	let blockStartLine = 0;

	lines.forEach((line, idx) => {
		const lineNum = idx + 1;
		const trimmed = line.trim();

		if (trimmed.startsWith('```mermaid')) {
			insideMermaid = true;
			blockStartLine = lineNum;
			return;
		}

		if (insideMermaid && trimmed.startsWith('```')) {
			insideMermaid = false;
			return;
		}

		if (insideMermaid) {
			// Skip comment lines in mermaid
			if (trimmed.startsWith('%%')) return;

			// Check for unquoted parentheses inside square brackets: id[Label (Extra)] -> should be id["Label (Extra)"]
			const bracketRegex = /\b[a-zA-Z0-9_-]+\[([^\]]+)\]/g;
			let match;
			while ((match = bracketRegex.exec(line)) !== null) {
				const content = match[1].trim();
				if (content.startsWith('(') && content.endsWith(')')) continue; // handled by cylinder check
				if (content.includes('(') || content.includes(')')) {
					if (!content.startsWith('"') || !content.endsWith('"')) {
						errorsCount++;
						report.push(`[Mermaid SyntaxError] ${file}:${lineNum} - Unquoted parentheses in node label: "${match[0]}" (Enclose label in double quotes: id["Label (Info)"])`);
					}
				}
			}

			// Check for cylinder node without internal quotes: id[(...)] -> should be id[("...")]
			const cylinderRegex = /\b[a-zA-Z0-9_-]+\[\(([^)]+)\)\]/g;
			while ((match = cylinderRegex.exec(line)) !== null) {
				const content = match[1].trim();
				if (!content.startsWith('"') || !content.endsWith('"')) {
					errorsCount++;
					report.push(`[Mermaid SyntaxError] ${file}:${lineNum} - Cylinder node label must be quoted: "${match[0]}" (Use: id[("Label")])`);
				}
			}
		}
	});

	if (insideMermaid) {
		errorsCount++;
		report.push(`[Mermaid SyntaxError] ${file}:${blockStartLine} - Unclosed \`\`\`mermaid code block`);
	}
}

// Summary Output
if (errorsCount > 0) {
	console.error(`\x1b[31m[FAILED] Found ${errorsCount} syntax error(s):\x1b[0m`);
	report.forEach(err => console.error(`  ${err}`));
	process.exit(1);
} else {
	console.log(`\x1b[32m[PASSED] Syntax check passed across JS (${jsFiles.length}), GAS (${gsFiles.length}), JSON (${jsonFiles.length}), and Markdown Mermaid (${mdFiles.length}) files.\x1b[0m`);
	process.exit(0);
}

