/** Preserve the originating authentication session across asynchronous rendering. */
export function captureRenderSession(coordinator, parent = null) {
	const key = coordinator.db.encryptionKey, generation = coordinator.authController?.authGeneration;
	return () => !coordinator.isKeyLocked && coordinator.db.encryptionKey === key && coordinator.authController?.authGeneration === generation && (!parent || parent());
}
