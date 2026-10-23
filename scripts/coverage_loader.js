import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { instrumentOriginal, knownSources, writeCoverageChunk } from './coverage_tools.js';

if (process.env.YOSE_NODE_COVERAGE) {
	const root = path.resolve(process.env.YOSE_COVERAGE_ROOT || process.cwd());
	const isProduction = file => (file.startsWith(root + '/js/') && file.endsWith('.js')) || (file.startsWith(root + '/gas/') && file.endsWith('.gs')) || file === path.join(root, 'sw.js');
	registerHooks({
		load(url, context, nextLoad) {
			if (!url.startsWith('file:')) return nextLoad(url, context);
			const file = fileURLToPath(url);
			if (!isProduction(file)) return nextLoad(url, context);
			const original = instrumentOriginal(file);
			if (file.endsWith('.gs')) return { format: 'commonjs', source: original.code, shortCircuit: true };
			return { ...nextLoad(url, context), source: original.code };
		}
	});
	process.on('exit', () => writeCoverageChunk(process.env.YOSE_NODE_COVERAGE, globalThis.__coverage__ || {}, knownSources));
}
