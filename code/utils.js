mdlr('enge:utils', ({ include }) => {

  const Base64 = include('base64');

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
		const defaults = { quality: 1, overscan: 0.00, tvEffect: true, ambilight: true, fullResTextures: true, textureFilter: 0, spriteFilter: 0 };

		return Object.assign(defaults, object);
	})();


	settings.updateQuality = quality => {
		const elem = document.getElementById('quality');
		const select = document.getElementById('quality-select');
		// the renderer sets maxQuality: 8 when it can render VRAM at 8x
		const max = settings.maxQuality || 4;
		if (quality === true) {
			settings.quality <<= 1;
			if (settings.quality > max) settings.quality = 1;
		}
		else if (quality !== undefined) {
			settings.quality = Math.min(Number(quality) || 1, max);
		}
		if (quality !== undefined) {
			localStorage.setItem('config', JSON.stringify(settings));
		}
		if (select) select.value = String(settings.quality);
		if (elem) elem.innerText = `Q${settings.quality}`;
	}

  window.addEventListener('storage', () => {
		const object = JSON.parse(localStorage.getItem('config') || '{}');
		Object.assign(settings, object);
  });

  return { log, hex, readStorageStream, writeStorageStream, settings };
})
