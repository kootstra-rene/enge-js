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

	function hex(value, len) {
		return ("00000000" + (value >>> 0).toString(16)).substr(-(len || 8));
	}
	
	function log() {
		console.log.call(console, ('000000000000' + (psx.clock)).substr(-12) + ']', Array.prototype.slice.call(arguments).join(''));
	}
	
	scope.log = log;
	scope.hex = hex;	
	scope.readStorageStream = readStorageStream;
	scope.writeStorageStream = writeStorageStream;

})(window);