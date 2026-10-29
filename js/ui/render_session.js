/** Preserve the originating authentication session across asynchronous rendering. */
export function captureRenderSession(coordinator, parent = null) {
	const key = coordinator.db.encryptionKey, keyGeneration = coordinator.db.keyGeneration, generation = coordinator.authController?.authGeneration, privateKey = coordinator.privateKey;
	return () => !coordinator.isKeyLocked && coordinator.db.encryptionKey === key && coordinator.db.keyGeneration === keyGeneration && coordinator.authController?.authGeneration === generation && coordinator.privateKey === privateKey && (!parent || parent());
}

/** Expired reads are cancellation; errors in the current session remain errors. */
export async function readInRenderSession(valid, read) {
	if (!valid()) return undefined;
	try {
		const result = await read();
		return valid() ? result : undefined;
	} catch (error) { if (valid()) throw error; }
}
