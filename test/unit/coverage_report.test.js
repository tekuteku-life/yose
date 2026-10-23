import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { productionFiles, validateRawCoverage, assertCoverageReport, instrumentOriginal, writeCoverageChunk } from '../../scripts/coverage_tools.js';

function workspace(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yose-coverage-contract-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	for (const dir of ['js/ui', 'gas', 'raw', 'reports']) fs.mkdirSync(path.join(root, dir), { recursive: true });
	for (const file of ['js/app.js', 'js/ui/controller.js', 'gas/Code.gs', 'sw.js']) fs.writeFileSync(path.join(root, file), 'function x(flag) { if (flag) { return 1; } else { return 2; } }\nx(true);\n');
	fs.writeFileSync(path.join(root, 'js/not-source.json'), '{}');
	return root;
}

describe('Coverage evidence contract', () => {
	it('enumerates every production JS/GAS/SW source independently of executed scripts', t => {
		const root = workspace(t);
		assert.deepEqual(productionFiles(root).map(file => path.relative(root, file)), ['gas/Code.gs', 'js/app.js', 'js/ui/controller.js', 'sw.js']);
	});
	it('rejects empty, corrupt, and invalid raw evidence', t => {
		const root = workspace(t);
		const dir = path.join(root, 'raw');
		assert.throws(() => validateRawCoverage(dir, productionFiles(root)), /raw/i);
		for (const text of ['{', '{}', '{"result":{}}', '{"result":[{"url":"x","functions":"invalid"}]}']) {
			fs.writeFileSync(path.join(dir, 'coverage-1.json'), text);
			assert.throws(() => validateRawCoverage(dir, productionFiles(root)), /raw|JSON/i);
		}
	});
	it('checks source hashes, original maps, and nonnegative integer counters', t => {
		const root = workspace(t);
		const file = path.join(root, 'js/app.js');
		const original = instrumentOriginal(file);
		const data = () => ({ coverage: { [file]: structuredClone(original.coverage) }, sources: { [file]: original.hash } });
		const write = raw => fs.writeFileSync(path.join(root, 'raw/coverage-1.json'), JSON.stringify(raw));
		write(data());
		assert.doesNotThrow(() => validateRawCoverage(path.join(root, 'raw'), productionFiles(root)));
		for (const count of [-1, 0.5, null]) {
			const invalid = data(); invalid.coverage[file].s[0] = count; write(invalid);
			assert.throws(() => validateRawCoverage(path.join(root, 'raw'), productionFiles(root)), /counter/i);
		}
		const wrongHash = data(); wrongHash.sources[file] = 'wrong'; write(wrongHash);
		assert.throws(() => validateRawCoverage(path.join(root, 'raw'), productionFiles(root)), /source/i);
		const wrongMap = data(); wrongMap.coverage[file].statementMap[0].start.line++; write(wrongMap);
		assert.throws(() => validateRawCoverage(path.join(root, 'raw'), productionFiles(root)), /map/i);
		const missingCounter = data(); delete missingCounter.coverage[file].s[0]; write(missingCounter);
		assert.throws(() => validateRawCoverage(path.join(root, 'raw'), productionFiles(root)), /counter/i);
		for (const type of ['f', 'b']) {
			for (const count of [-1, 0.5, null]) {
				const invalid = data();
				if (type === 'b') invalid.coverage[file].b[0][0] = count; else invalid.coverage[file].f[0] = count;
				write(invalid);
				assert.throws(() => validateRawCoverage(path.join(root, 'raw'), productionFiles(root)), /counter/i);
			}
			const missing = data(); delete missing.coverage[file][type][0]; write(missing);
			assert.throws(() => validateRawCoverage(path.join(root, 'raw'), productionFiles(root)), /counter/i);
		}
		for (const value of [[0], [0, 0, 0], null, [0, null]]) {
			const wrongBranch = data(); wrongBranch.coverage[file].b[0] = value; write(wrongBranch);
			assert.throws(() => validateRawCoverage(path.join(root, 'raw'), productionFiles(root)), /counter/i);
		}
		for (const map of ['fnMap', 'branchMap']) {
			const wrong = data(); wrong.coverage[file][map][0].loc.start.line++; write(wrong);
			assert.throws(() => validateRawCoverage(path.join(root, 'raw'), productionFiles(root)), /map/i);
		}
	});
	it('rejects missing report files, additional files, or per-file rates below 97%', t => {
		const root = workspace(t);
		const expected = productionFiles(root);
		const report = Object.fromEntries(expected.map(file => [file, { lines: { pct: 100 }, branches: { pct: 100 } }]));
		const dir = path.join(root, 'reports');
		const write = value => fs.writeFileSync(path.join(dir, 'coverage-summary.json'), JSON.stringify(value));
		write(report);
		assert.doesNotThrow(() => assertCoverageReport(dir, expected));
		const missing = { ...report }; delete missing[expected[0]]; write(missing);
		assert.throws(() => assertCoverageReport(dir, expected), /files/i);
		write({ ...report, extra: report[expected[0]] });
		assert.throws(() => assertCoverageReport(dir, expected), /files/i);
		for (const metric of ['lines', 'branches']) {
			const changed = structuredClone(report); changed[expected[0]][metric].pct = 96.99; write(changed);
			assert.throws(() => assertCoverageReport(dir, expected), /97/);
		}
	});
	it('stores only nonzero deltas while rejecting invalid zero records', t => {
		const root = workspace(t);
		const files = productionFiles(root);
		const coverage = Object.fromEntries(files.map(file => [file, structuredClone(instrumentOriginal(file).coverage)]));
		const sources = new Map(files.map(file => [file, instrumentOriginal(file).hash]));
		coverage[files[0]].b[0][1] = 1;
		writeCoverageChunk(path.join(root, 'raw'), coverage, sources);
		const rawFiles = fs.readdirSync(path.join(root, 'raw'));
		assert.equal(rawFiles.length, 1);
		const raw = JSON.parse(fs.readFileSync(path.join(root, 'raw', rawFiles[0]), 'utf8'));
		assert.deepEqual(Object.keys(raw.coverage), [files[0]]);
		assert.equal(raw.coverage[files[0]].b[0][1], 1);
		coverage[files[1]].branchMap[0].loc.start.line++;
		assert.throws(() => writeCoverageChunk(path.join(root, 'raw'), coverage, sources), /map/);
	});
});
