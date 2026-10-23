/** 初回描画前に保存済みテーマを適用する。 */
(function() {
	try {
		const saved = localStorage.getItem('yose_theme_preference');
		const theme = saved || 'system';
		let resolved = theme;
		if (theme === 'system') {
			resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
		}
		document.documentElement.setAttribute('data-theme', resolved);
	} catch (e) {}
})();
