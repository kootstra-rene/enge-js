mdlr('[test]enge:psx:gte', ({ include, test }) => {

  const { describe, it, xit, expect } = test;

  const { gte } = include('enge:psx:gte');
  const { groups } = include('enge:psx:gte-fuzz-data');

  // Replays the hardware capture from ps1-tests gte-fuzz: write r0..r63 in
  // order, run the command, read r0..r63 back and compare with the hardware.
  const decode = (b64) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return new Uint32Array(bytes.buffer);
  };

  const hex = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

  const run = (words, index) => {
    const base = index * 129;
    const command = words[base];

    for (let r = 0; r < 64; ++r) {
      gte.set(r, words[base + 1 + r] >> 0);
    }
    if (command !== 0xffffffff) {
      gte.command(command);
    }

    const mismatches = [];
    for (let r = 0; r < 64; ++r) {
      const actual = gte.get(r) >>> 0;
      const expected = words[base + 65 + r];
      if (actual !== expected) mismatches.push(`r${r} ${hex(actual)} != ${hex(expected)}`);
    }
    return mismatches;
  };

  // Commands that do not match the hardware capture yet. Remove an entry once
  // its group passes; the skipped groups show up as known failures.
  const knownFailing = new Set([
    0x01, // RTPS
    0x10, // DPCS
    0x11, // INTPL
    0x12, // MVMVA
    0x13, // NCDS
    0x14, // CDP
    0x16, // NCDT
    0x1b, // NCCS
    0x1c, // CC
    0x1e, // NCS
    0x20, // NCT
    0x29, // DCPL
    0x2a, // DPCT
    0x30, // RTPT
    0x3d, // GPF
    0x3e, // GPL
    0x3f, // NCCT
  ]);

  describe('hardware fuzz (seed 0xc0ffee)', () => {

    for (const { op, name, count, data } of groups) {
      const label = op === 0x40 ? 'register write/readback (no command)' : `${name} (0x${op.toString(16).padStart(2, '0')})`;
      const title = `${label} should match hardware for all ${count} cases`;

      if (knownFailing.has(op)) {
        xit(title);
        continue;
      }

      it(title, async () => {
        const words = decode(data);
        const failures = [];

        for (let i = 0; i < count; ++i) {
          const mismatches = run(words, i);
          if (mismatches.length) failures.push(`case ${i + 1}: ${mismatches.join(', ')}`);
        }

        expect({ failing: failures.length, first: failures.slice(0, 3) }).to.eql({ failing: 0, first: [] });
      });
    }

  });

})
