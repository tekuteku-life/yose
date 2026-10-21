import fs from 'node:fs';
const sourcePath = new URL('../js/logic/data_integrity.js', import.meta.url);
const gasPath = new URL('../gas/Code.gs', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8').replace(/^export /gm, '').trim();
const start = '// BEGIN GENERATED DATA INTEGRITY';
const end = '// END GENERATED DATA INTEGRITY';
const block = `${start}\n${source}\n${end}`;
const gas = fs.readFileSync(gasPath, 'utf8');
const existing = gas.match(/\/\/ BEGIN GENERATED DATA INTEGRITY[\s\S]*?\/\/ END GENERATED DATA INTEGRITY/);
if (process.argv.includes('--check')) {
	if (existing?.[0] !== block) { process.stderr.write('GAS integrity validator is out of sync. Run node scripts/sync_gas_integrity.mjs\n'); process.exit(1); }
} else {
	const updated = existing ? gas.replace(existing[0], block) : gas.replace('// Export for Node testing environment', `${block}\n\n// Export for Node testing environment`);
	fs.writeFileSync(gasPath, updated);
}
