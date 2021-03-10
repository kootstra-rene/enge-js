# design decisions

## recompiler optimisations

At the moment of writing this the emulator runs at roughly 50% capacity on my laptop whereas the first iteration ran at ~80%. Most of the optimsations were achieved by writing slightly clever code in the rest of the emulator and adjusting the timings.  The only optimisation done in the recompiler is 'constant folding', which resulted into a 5-10% performance increase.  A nice example is the reboot vector code. 
| before | after |
|--------|-------|
|function dynBFC00000() { | function dynBFC00000() { |
|  **const gpr = cpu.gpr;** |  **const gpr = cpu.gpr;** |
|  // bfc00000: 3c080013: lui     r8, $0013 |  // bfc00000: 3c080013: lui     r8, $0013 |
|  **gpr[8] = 0x00130000;** |  // bfc00004: 3508243f: ori     r8, r8, $243f |
|  // bfc00004: 3508243f: ori     r8, r8, $243f |  // bfc00008: 3c011f80: lui     r1, $1f80 |
|  **gpr[8] = gpr[8] \| 0x243f;** |  // bfc0000c: ac281010: sw      r8, $1010(r1) |
|  // bfc00008: 3c011f80: lui     r1, $1f80 |  **memWrite32((0x1f801010 >>> 0), (0x0013243f >> 0));** |
|  **gpr[1] = 0x1f800000;** |  // bfc00010: 00000000: nop |
|  // bfc0000c: ac281010: sw      r8, $1010(r1) |  // bfc00014: 24080b88: addiu   r8, r0, $0b88 |
|  **memWrite32(((4112 + gpr[1]) >>> 0), gpr[8]);** |  // bfc00018: 3c011f80: lui     r1, $1f80 |
|  // bfc00010: 00000000: nop |  // bfc0001c: ac281060: sw      r8, $1060(r1) |
|  // bfc00014: 24080b88: addiu   r8, r0, $0b88 |  **memWrite32((0x1f801060 >>> 0), (0x00000b88 >> 0));** |
|  **gpr[8] = 2952;** |  // bfc00020: 00000000: nop |
|  // bfc00018: 3c011f80: lui     r1, $1f80 |  // bfc00024: 00000000: nop |
|  **gpr[1] = 0x1f800000;** |  // bfc00028: 00000000: nop |
|  // bfc0001c: ac281060: sw      r8, $1060(r1) |  // bfc0002c: 00000000: nop |
|  **memWrite32(((4192 + gpr[1]) >>> 0), gpr[8]);** |  // bfc00030: 00000000: nop |
| ... | ... |
|  // bfc0005c: 00000000: nop |  // bfc00070: 0bf00054: j       $bfc00150 |
|  // bfc00060: 00000000: nop |  **var pc = 0xbfc00150** |
|  // bfc00064: 00000000: nop |  // bfc00074: 00000000: nop |
|  // bfc00068: 00000000: nop |  // flush constants |
|  // bfc0006c: 00000000: nop |  **gpr[1] = 0x1f800000;** |
|  // bfc00070: 0bf00054: j       $bfc00150 |  **gpr[8] = 0x00000b88;** |
|  **var pc = 0xbfc00150** |  **psx.clock += 30;** |
|  // bfc00074: 00000000: nop |  **cpu.pc = pc;** |
|  **psx.clock += 30;** |} |
|  **cpu.pc = pc;** ||
|}||

One can clearly see the 'constant folding' at work producing writes to known memory locations and setting of registers with constants. Though one would expect that this has a huge improvement, it effect is limitted because most of the game code just isn't using a lot of constants.
### Analysis of current recompiler
Running the profiler on 'Crash Bash' for roughly 485 seconds of emulation time we get the following results when sorting on Total Time:
| Self Time | Total Time | Function |
|-----------|------------|----------|
| 493331.0ms | 493331.0 ms | (idle) |
| 114997.6ms 26.51% | 291366.9ms 67.17% | mainLoop |
| 36155.5ms 8.34% |  48361.7ms 11.15% | dyn80174870 |
| 163.6ms 0.04% | 39639.7ms 9.14% | psx.handleEvents |
| 16200.6ms 3.74% | 16201.8ms 3.74% | dyn801748BC |
| 30.0ms 0.01% | 6279.7ms 1.45% | dyn8017D3E8 |
| 816.3ms 0.19% | 4333.8ms 1.00% | dyn80153580 |
| 1135.5ms 0.26% | 3417.1ms 0.79% | dyn80153350 |
| 2368.2ms 0.55% | 2881.1ms 0.66% | dyn80177228 |

*psx.handleEvents* contains the logic to handle all timing related events. *mainLoop* is called every '*requestAnimationFrame*' and runs the emulation process. It calls the recompiled functions as long as the emulation time matches the 'host' time. The *dynXXXXXXXX* functions are the recompiled pieces of PSX code.  The table clearly shows that most of the time is spent in the *mainLoop* and *psx.handleEvents*.  The conclusion that we can take here is that the recompiled PSX code is not the bottleneck and that the most logical improvement should be in **mainLoop** as 'the Self Time' is over 25%.

Looking at the mainLoop internals most of the time is spent in the following piece of code:
```JavaScript
while (psx.clock < totalCycles) {
  const block = recompile(cpu.pc >>> 0);
  block.called++;
  block.code();

  if (psx.clock >= psx.eventClock) {
    psx.handleEvents();
    cpuInterrupt();
  }
}
```
Not much to optimize here as the recompile fetches > 99% from the cache. The handle of events and generations of IRQ's are only performed when needed. It looks to be optimal so why does it spent so much time in this part of the mainLoop. The answer can be found in the *called* counter on each block. Adding all the *called* values from all blocks yields a staggering **1516488754** invocations or **3126781** invocations per second. With the playstation running at 33868800 cycles per second the emulator, the average block emulates 11 cycles. That does explain the high 'Self Time' percentage. In conclusion the only way to reduce the overhead of the mainLoop is to increase the number of cycles per block. However due to the nature of the current recompiler where each block is ended at branches and jumps it would require a complete rewrite and preferably to be avoided.

I decided to let the emulator run for a longer time and see which recompiled functions over time would standout. After roughly 6.5 hours the total invocations were **75775075394** and still with an average of 11 cycles per block. Looking at the individual blocks and sorting them on the amount of invocations we get the following top 5:
| Function | Invocations |
|----------|-------------|
|dyn800322D4|25401374977|
|dyn8003228C|25400315594|
|dyn80048FD0|8970389532|
|dyn80010614|725471469|
|dyn80019540|659256048|

This means that the top 3 functions account for 78.8% of the invocations. The definition of these functions are respectively:

```JavaScript
function dyn800322D4(){ 
  const gpr = cpu.gpr;
  // 800322d4: 3c028007: lui     r2, $8007
  // 800322d8: 8c42d8dc: lw      r2, $d8dc(r2)
  gpr[2] = memRead32((0x8006d8dc >>> 0)) >> 0;
  // 800322dc: 00000000: nop
  // 800322e0: 0044102a: slt     r2, r2, r4
  gpr[2] = (gpr[2] >> 0) < (gpr[4] >> 0);
  // 800322e4: 1440ffe9: bne     r2, r0, $ffe9
  var pc = (gpr[2] !== (0x00000000 >> 0)) ? 0x8003228c : 0x800322ec;
  // 800322e8: 00000000: nop
  psx.clock += 6;
  cpu.pc = pc;
}
```

```JavaScript
function dyn8003228C(){ 
  const gpr = cpu.gpr;
  // 8003228c: 8fa20010: lw      r2, $0010(r29)
  gpr[2] = memRead32(((16 + gpr[29]) >>> 0)) >> 0;
  // 80032290: 00000000: nop
  // 80032294: 2442ffff: addiu   r2, r2, $ffff
  gpr[2] = -1 + gpr[2];
  // 80032298: afa20010: sw      r2, $0010(r29)
  memWrite32(((16 + gpr[29]) >>> 0), gpr[2]);
  // 8003229c: 8fa20010: lw      r2, $0010(r29)
  gpr[2] = memRead32(((16 + gpr[29]) >>> 0)) >> 0;
  // 800322a0: 00000000: nop
  // 800322a4: 1443000b: bne     r2, r3, $000b
  var pc = (gpr[2] !== gpr[3]) ? 0x800322d4 : 0x800322ac;
  // 800322a8: 00000000: nop
  psx.clock += 8;
  cpu.pc = pc;
}
```

```JavaScript
function dyn80010614(){ 
  const gpr = cpu.gpr;
  // 80010614: 8cc20000: lw      r2, $0000(r6)
  gpr[2] = memRead32((gpr[6] >>> 0)) >> 0;
  // 80010618: 24c60004: addiu   r6, r6, $0004
  gpr[6] = 4 + gpr[6];
  // 8001061c: 24a5ffff: addiu   r5, r5, $ffff
  gpr[5] = -1 + gpr[5];
  // 80010620: ace20000: sw      r2, $0000(r7)
  memWrite32((gpr[7] >>> 0), gpr[2]);
  // 80010624: 14a3fffb: bne     r5, r3, $fffb
  var pc = (gpr[5] !== gpr[3]) ? 0x80010614 : 0x8001062c;
  // 80010628: 24e70004: addiu   r7, r7, $0004
  gpr[7] = 4 + gpr[7];
  psx.clock += 6;
  cpu.pc = pc;
}
```

Looking at the code we see 2 interesting properties of the functions:
- *dyn80010614* is a loop function. The branch target is the function it self.
- *dyn800322D4* jumps to *dyn8003228C* and vice versa.
If we can optimise the these two conditions in the recompiler we have the largest impact on performance of the emulator. But this is just for one game so lets check another.

Running 'Legend of Mana' for roughly 3 minutes we get **789995231** invocations that is an average of 8 cycles per block.  
| Function | Invocations |
|:--------:|:-----------:|
|dyn8001FEA8|350993336|
|dyn80020734|46018725|
|dyn800206EC|46014609|
|dyn800191AC|20435345|
|dyn80019240|20370641|

This means that the top 3 functions account for 56.1% of the invocations. The definition of these functions are respectively:

```JavaScript
function dyn8001FEA8(){ 
  const gpr = cpu.gpr;
  // 8001fea8: 8c620000: lw      r2, $0000(r3)
  gpr[2] = memRead32((gpr[3] >>> 0)) >> 0;
  // 8001feac: 00000000: nop
  // 8001feb0: 00441024: and     r2, r2, r4
  gpr[2] = gpr[2] & gpr[4];
  // 8001feb4: 1440fffc: bne     r2, r0, $fffc
  var pc = (gpr[2] !== (0x00000000 >> 0)) ? 0x8001fea8 : 0x8001febc;
  // 8001feb8: 00000000: nop
  psx.clock += 5;
  cpu.pc = pc;
}
```

```JavaScript
function dyn80020734(){ 
  const gpr = cpu.gpr;
  // 80020734: 3c028004: lui     r2, $8004
  // 80020738: 8c42cff0: lw      r2, $cff0(r2)
  gpr[2] = memRead32((0x8003cff0 >>> 0)) >> 0;
  // 8002073c: 00000000: nop
  // 80020740: 0044102a: slt     r2, r2, r4
  gpr[2] = (gpr[2] >> 0) < (gpr[4] >> 0);
  // 80020744: 1440ffe9: bne     r2, r0, $ffe9
  var pc = (gpr[2] !== (0x00000000 >> 0)) ? 0x800206ec : 0x8002074c;
  // 80020748: 00000000: nop
  psx.clock += 6;
  cpu.pc = pc;
}
```

```JavaScript
function dyn800206EC(){ 
  const gpr = cpu.gpr;
  // 800206ec: 8fa20010: lw      r2, $0010(r29)
  gpr[2] = memRead32(((16 + gpr[29]) >>> 0)) >> 0;
  // 800206f0: 00000000: nop
  // 800206f4: 2442ffff: addiu   r2, r2, $ffff
  gpr[2] = -1 + gpr[2];
  // 800206f8: afa20010: sw      r2, $0010(r29)
  memWrite32(((16 + gpr[29]) >>> 0), gpr[2]);
  // 800206fc: 8fa20010: lw      r2, $0010(r29)
  gpr[2] = memRead32(((16 + gpr[29]) >>> 0)) >> 0;
  // 80020700: 00000000: nop
  // 80020704: 1443000b: bne     r2, r3, $000b
  var pc = (gpr[2] !== gpr[3]) ? 0x80020734 : 0x8002070c;
  // 80020708: 00000000: nop
  psx.clock += 8;
  cpu.pc = pc;
}
```

Looking at these functions we see the same interesting properties:
- *dyn8001FEA8* is a inner-loop function. The branch target is the function it self.
- *dyn80020734* jumps to *dyn800206EC* and vice versa. lets call it an outer-loop function

More interrestingly is the fact that the code of the non-loop functions is completely identical but just positioned at a different memory location.

Running multiple games and demo's yields similar results. There is always a loop function in the top 5 and in most cases the two referring function seem to be there too. My guess would be that it is related to the missing 'halt' functionality on the PSone. The R3000A is always running and that means that somehwere it needs to loop until a change occurs. So if we would optimise this idle loop we already should see a substantial performance improvement.

## Measuring during emulation
Inline with the previous sections the code has been modified to measure the behavior in more details but also implemented the inner-loop functionality. As expected the inner-loop optimisation improved the performance in some instances especially in demos.  Secondly, the jump points are added to the recompiled function state and also the number of invocations are counted.  The analytics functionality of the previous section have been implemented and can be called after running the emulator for a while.

The assumptions in the analytics part have been confirmed in many cases but are mostly effective during the actual game play and not during movie sequences.

Here the results of playing Harry Potter until completing the initial Ghoul game.

Running: *getCodeStats(**0**,5).map(a => \`${a.addr} - ${a.calls}\`).join()* gives us the 5 most called level 0 function addresses and the number of invocations. Clearly showing that the top 3 is responsible for most of the invocations.
```
800610a4 - 248833640,
8006105c - 248813150,
0006b5e4 - 210066480,
8005d7b0 - 13382536,
00010db4 - 9542646
```

Running *getCodeStats(**1**,5).map(a => \`${a.addr} - ${a.calls}\`).join()* gives us the 5 most called level 1 (inner-loop) function addresses and the number of invocations. The top function here is number #3 in the level 0 functions. Indicating that loop optimisation does improve the performance.
```
0006b5e4 - 210066480,
8005d7b0 - 13382536,
00010e74 - 6791202,
00015844 - 2808832,
0005b41c - 1419395
```

Running *getCodeStats(**2**,5).map(a => \`${a.addr} - ${a.calls}\`).join()* gives us the 5 most called level 2 (outer-loop) function addresses and the number of invocations. Outer loops are a recompiled functions that jump to another function and that function jumps back. The two top functions also are the top functions on level 0.
```
800610a4 - 248833640,
8006105c - 248813150,
00010db4 - 9542646,
00010d34 - 9539271,
00014bbc - 2674064
```

In conclusion detecting the inner-loop and outer-loop functions and optimising the compiler would possibly give a good performance improvement without refactoring to much code.
