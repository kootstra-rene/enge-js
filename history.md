history.md

2021-03-10: added quality selector Q1,Q2,Q4 for higher quality graphics
2021-03-08: added gamepad support and file selection
2021-03-05: adapted recompiler to support level-1 and level-2 loops, substantial increase in performance.
2021-03-04: adapted recompiler to collect statistics  
2021-03-02: fixed a rendering bug by flushing vertices before storing an image. needed for using older clut.  
2021-02-28: root-counter seem to work properly again (toggle and single-shot not yet implemented)  
2021-02-25: started complete rewrite of root-counters  
2021-02-23: removed pressure on mainLoop by pre-fetching branch targets in recompiled code  
2021-02-20: reduced basic constant folding to offsets only  
2021-02-16: added basic constant folding to recompiler  
2021-02-15: starting refactoring recompiler to reduce overhead for mainloop (goal to minimize code lookup should give 10% more performance)  
2021-02-14: refactoring cycle counting to event system (5% performance improvement)  
2021-02-08: initial WebGL2 rendering for faster graphics (mainly due to integer math needed for texture.window) only MDEC video  
