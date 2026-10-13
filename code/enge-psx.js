mdlr('enge:psx', ({ include }) => {

  Object.assign(window,
    include('enge:psx:core'),
    include('enge:psx:trace'),
  );

  Object.assign(window,
    include('enge:psx:serial'),
    include('enge:psx:gamepad'),

    include('enge:psx:cpu'),
    include('enge:psx:cdr'),
    include('enge:psx:mdec'),
    include('enge:psx:gpu'),
    include('enge:psx:gte'),
    include('enge:psx:mmu'),
    include('enge:psx:rec'),
    include('enge:psx:spu'),
    include('enge:psx:stall'),
  );

  Object.assign(window,
    include('enge:psx:index'),
  );

})