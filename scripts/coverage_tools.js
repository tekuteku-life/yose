import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import instrumentLib from 'istanbul-lib-instrument';
import coverageLib from 'istanbul-lib-coverage';
import reportLib from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const instruments = new Map();
export const knownSources = new Map();
const hash = source => createHash('sha256').update(source).digest('hex');

export function productionFiles(root) {
	const files = [];
	function collect(dir, extension) {
		if (!fs.existsSync(dir)) return;
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const file = path.join(dir, entry.name);
			if (entry.isDirectory()) collect(file, extension);
			else if (entry.name.endsWith(extension)) files.push(path.resolve(file));
		}
	}
	collect(path.join(root, 'js'), '.js');
	collect(path.join(root, 'gas'), '.gs');
	if (fs.existsSync(path.join(root, 'sw.js'))) files.push(path.resolve(root, 'sw.js'));
	return files.sort();
}

export function instrumentOriginal(file) {
	file = path.resolve(file);
	const source = fs.readFileSync(file, 'utf8');
	const sourceHash = hash(source);
	let result = instruments.get(file);
	if (!result || result.hash !== sourceHash) {
		const instrumenter = instrumentLib.createInstrumenter({ compact: false, preserveComments: true, esModules: true, coverageGlobalScope: 'globalThis', coverageGlobalScopeFunc: false });
		const code = instrumenter.instrumentSync(source, file);
		result = { code, hash: sourceHash, coverage: instrumenter.lastFileCoverage() };
		instruments.set(file, result);
	}
	knownSources.set(file, result.hash);
	return result;
}

// VM tests execute the same original with standard counters only when collection is enabled.
export function productionSource(file) {
	return process.env.YOSE_NODE_COVERAGE ? instrumentOriginal(file).code : fs.readFileSync(file, 'utf8');
}

export function coverageGlobals() {
	return process.env.YOSE_NODE_COVERAGE ? { __coverage__: globalThis.__coverage__ ||= {} } : {};
}

function validateChunk(raw, expectedFiles) {
	if (!raw || !raw.coverage || typeof raw.coverage !== 'object' || Array.isArray(raw.coverage) || !raw.sources || typeof raw.sources !== 'object') throw new Error('Invalid raw coverage structure');
	const expected = new Set(expectedFiles);
	for (const [file, data] of Object.entries(raw.coverage)) {
		if (!expected.has(file) || data.path !== file) throw new Error(`Unknown raw coverage source: ${file}`);
		const original = instrumentOriginal(file);
		if (raw.sources[file] !== original.hash) throw new Error(`Coverage source differs from original: ${file}`);
		for (const map of ['statementMap', 'fnMap', 'branchMap']) {
			if (JSON.stringify(data[map]) !== JSON.stringify(original.coverage[map])) throw new Error(`Coverage map differs from original: ${file} ${map}`);
		}
		for (const type of ['s', 'f', 'b']) {
			if (!data[type] || JSON.stringify(Object.keys(data[type]).sort()) !== JSON.stringify(Object.keys(original.coverage[type]).sort())) throw new Error(`Invalid coverage counter keys: ${file}`);
			for (const [key, counter] of Object.entries(data[type])) {
				const values = type === 'b' ? counter : [counter];
				if (!Array.isArray(values) || (type === 'b' && values.length !== original.coverage.b[key].length) || values.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error(`Invalid coverage counter: ${file}`);
			}
		}
	}
}

export function writeCoverageChunk(dir, coverage, sources) {
	const raw = { coverage, sources: Object.fromEntries(sources) };
	validateChunk(raw, [...sources.keys()]);
	const active = Object.entries(coverage).filter(([, data]) => Object.values(data.s).some(count => count > 0) || Object.values(data.f).some(count => count > 0) || Object.values(data.b).some(counts => counts.some(count => count > 0)));
	if (!active.length) return;
	raw.coverage = Object.fromEntries(active);
	raw.sources = Object.fromEntries(active.map(([file]) => [file, sources.get(file)]));
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, `coverage-${process.pid}-${randomUUID()}.json`), JSON.stringify(raw));
}

export function validateRawCoverage(dir, expectedFiles) {
	const chunks = fs.readdirSync(dir).filter(name => name.endsWith('.json'));
	if (!chunks.length) throw new Error('Missing raw coverage evidence');
	for (const name of chunks) {
		let raw;
		try { raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
		catch (error) { throw new Error(`Invalid raw JSON ${name}: ${error.message}`); }
		validateChunk(raw, expectedFiles);
	}
	return chunks.length;
}

export function generateCoverageReport(root, rawDir, reportDir, text = false) {
	const files = productionFiles(root);
	validateRawCoverage(rawDir, files);
	const coverageMap = coverageLib.createCoverageMap({});
	for (const file of files) coverageMap.addFileCoverage(structuredClone(instrumentOriginal(file).coverage));
	for (const name of fs.readdirSync(rawDir).filter(name => name.endsWith('.json'))) coverageMap.merge(JSON.parse(fs.readFileSync(path.join(rawDir, name), 'utf8')).coverage);
	const context = reportLib.createContext({ dir: reportDir, coverageMap });
	for (const reporter of [...(text ? ['text'] : []), 'json', 'json-summary', 'html']) reports.create(reporter).execute(context);
	return coverageMap.getCoverageSummary().toJSON();
}

export function assertCoverageReport(reportDir, expectedFiles) {
	const summary = JSON.parse(fs.readFileSync(path.join(reportDir, 'coverage-summary.json'), 'utf8'));
	const actual = Object.keys(summary).filter(file => file !== 'total').sort();
	const expected = [...expectedFiles].sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Coverage report files differ from production manifest: expected ${expected.length}, got ${actual.length}`);
	const failures = [];
	for (const file of expected) {
		for (const metric of ['lines', 'branches']) {
			const pct = summary[file]?.[metric]?.pct;
			if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 97) failures.push(`${file}: ${metric}=${pct}, required >=97%`);
		}
	}
	if (failures.length) throw new Error(failures.join('\n'));
}
