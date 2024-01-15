mdlr('enge:utils', m => {

  const Base64 = m.require('base64');

  function readStorageStream(item, handler) {
    const base64text = localStorage.getItem(item);
    if (base64text) {
      const arrayBuffer = Base64.decode(base64text);
      return handler(arrayBuffer);
    }
    else {
      return handler(null);
    }
  }

  function writeStorageStream(item, arrayBuffer) {
    const base64text = Base64.encode(arrayBuffer);
    localStorage.setItem(item, base64text);
  }

  function hex(value, len) {
    return ("00000000" + (value >>> 0).toString(16)).substr(-(len || 8));
  }

  function log() {
    console.log.call(console, ('000000000000' + (psx.clock)).substr(-12) + ']', Array.prototype.slice.call(arguments).join(''));
  }

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

  window.addEventListener('storage', () => {
		const object = JSON.parse(localStorage.getItem('config') || '{}');
		Object.assign(settings, object);
  });

  return { log, hex, readStorageStream, writeStorageStream, settings };
})