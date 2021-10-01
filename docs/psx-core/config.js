'use strict';

const settings = (() => {
	let object = JSON.parse(localStorage.getItem('config') || '{"quality": 1}');
	if (object.naiveResolutionImprovement === undefined) object.naiveResolutionImprovement = true;
	return object;
})();


settings.updateQuality = update => {
	const elem = document.getElementById('quality');

	if (update) {
		settings.quality <<= 1;
		if (settings.quality > 8) settings.quality = 1;

		localStorage.setItem('config', JSON.stringify(settings));
		elem.classList.add('restart');
	}

	elem.innerText = `Q${settings.quality}`;
}