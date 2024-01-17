mdlr('enge:psx', m => {

  Object.assign(window,
    m.require('enge:psx:core'),
    m.require('enge:psx:trace'),
  );

  Object.assign(window,
    m.require('enge:psx:serial'),
    m.require('enge:psx:gamepad'),

    m.require('enge:psx:cpu'),
    m.require('enge:psx:cdr'),
    m.require('enge:psx:mdec'),
    m.require('enge:psx:gpu'),
    m.require('enge:psx:gte'),
    m.require('enge:psx:dma'),
    m.require('enge:psx:mmu'),
    m.require('enge:psx:rec'),
    m.require('enge:psx:rtc'),
    m.require('enge:psx:spu'),
  );

  Object.assign(window,
    m.require('enge:psx:index'),
  );

})