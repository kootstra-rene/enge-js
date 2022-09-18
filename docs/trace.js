(scope => {

	'use strict';

	const gameCodeRegEx = /[A-Za-z]{4}_[0-9]{3}\.[0-9]{2}/;

	let line = '';
	let lastLine = null;

	function traceBiosCalls(programCounter, functionId) {
		switch (programCounter) {
			case 0xa0:
				switch (functionId) {
					case 0x3c: BIOS_std_out_putchar(cpu.gpr[4]);
						break;
				}
				break;

			case 0xb0:
				switch (functionId) {
					case 0x3d: BIOS_std_out_putchar(cpu.gpr[4]);
						break;
				}
				break;
		}
	}

	function BIOS_std_out_putchar(charCode) {
		line += String.fromCharCode(charCode);
		if (charCode === 10 || charCode === 13) {
			if (line !== lastLine) {
				extractGameCodeFromCurrentLine();
				lastLine = line;
			}
			console.debug(line);
			line = '';
		}
	}

	function extractGameCodeFromCurrentLine() {
		const result = gameCodeRegEx.exec(line);
		if (result) {
			let gc = result[0].replace('.', '').toUpperCase();
			if (gameCode !== gc) {
				document.title = `eNGE - [${gc}]`;
				gameCode = gc;
			}
		}
	}

	scope.trace = traceBiosCalls;
	scope.gameCode = '';

})(window);