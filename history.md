history.md

2021:02-08: initial WebGL2 rendering for faster graphics (mainly due to integer math needed for texture.window) only MDEC video
2021-02-14: refactoring cycle counting to event system (5% performance improvement)
2021-02-15: starting refactoring recompiler to reduce overhead for mainloop (goal to minimize code lookup should give 10% more performance)
2021-02-16: added basic constant folding to recompiler