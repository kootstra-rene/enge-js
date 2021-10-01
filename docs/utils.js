(scope => {

	'use strict';

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

	scope.readStorageStream = readStorageStream;
	scope.writeStorageStream = writeStorageStream;

})(window);