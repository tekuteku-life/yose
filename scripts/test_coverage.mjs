import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { productionFiles, validateRawCoverage, generateCoverageReport, assertCoverageReport } from './coverage_tools.js';

const root = process.cwd();
const reportDir = path.join(root, 'coverage');
const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yose-coverage-'));
const rawDir = path.join(evidenceDir, 'raw'); fs.mkdirSync(rawDir);
const files = productionFiles(root);
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest = files.map(file => ({ file, sha256: hash(file) }));
fs.writeFileSync(path.join(evidenceDir, 'manifest.json'), JSON.stringify(manifest, null, '\t'));
console.log(`Coverage evidence: ${evidenceDir}`);

async function run(command, args, env) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
		child.on('error', reject);
		child.on('exit', code => resolve(code === 0));
	});
}

const baseEnv = { ...process.env }; delete baseEnv.NODE_V8_COVERAGE; delete baseEnv.YOSE_BROWSER_COVERAGE; delete baseEnv.YOSE_NODE_COVERAGE;
if (!await run('npm', ['run', 'lint'], baseEnv)) process.exit(1);
const nodeFiles = ['unit', 'integration', 'system'].flatMap(dir => fs.readdirSync(path.join(root, 'test', dir)).filter(file => file.endsWith('.test.js')).map(file => `test/${dir}/${file}`));
const uiFiles = fs.readdirSync(path.join(root, 'test/ui')).filter(file => file.endsWith('.test.js')).map(file => `test/ui/${file}`);
const nodePassed = await run(process.execPath, ['--import', './scripts/coverage_loader.js', '--test', ...nodeFiles], { ...baseEnv, YOSE_COVERAGE_ROOT: root, YOSE_NODE_COVERAGE: rawDir });
const uiPassed = await run(process.execPath, ['--test', '--test-concurrency=4', ...uiFiles], { ...baseEnv, YOSE_BROWSER_COVERAGE: rawDir });
if (JSON.stringify(productionFiles(root)) !== JSON.stringify(files) || manifest.some(entry => hash(entry.file) !== entry.sha256)) throw new Error('Production source changed during coverage collection');
validateRawCoverage(rawDir, files);
console.log(generateCoverageReport(root, rawDir, reportDir, true));
fs.copyFileSync(path.join(evidenceDir, 'manifest.json'), path.join(reportDir, 'source-manifest.json'));
fs.writeFileSync(path.join(reportDir, 'execution.json'), JSON.stringify({ evidenceDir, nodePassed, uiPassed }, null, '\t'));
try { assertCoverageReport(reportDir, files); }
catch (error) { console.error(error.message); process.exitCode = 1; }
if (!nodePassed || !uiPassed) process.exitCode = 1;
