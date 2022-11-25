(scope => {

	'use strict';

	const settings = (() => {
		const object = JSON.parse(localStorage.getItem('config') || '{}');
		const defaults = { quality: 1, overscan: 0.00 };

		return Object.assign(defaults, object);
	})();


	settings.updateQuality = update => {
		const elem = document.getElementById('quality');
		if (!elem) return;

		if (update) {
			settings.quality <<= 1;
			if (settings.quality > 4) settings.quality = 1;

			localStorage.setItem('config', JSON.stringify(settings));
			elem.classList.add('restart');
		}

		elem.innerText = `Q${settings.quality}`;
	}

	scope.settings = settings;

})(window);
