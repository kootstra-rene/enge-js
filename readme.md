# Why this emulator
Everybody said you can't run a PSXone emulator in JavaScript at full speed in the browser. It's too slow...
You have the emscriptem based ones but that is not plain JavScript and also those emulators don't run at full speed. So to learn JavaScript and further my programming knowledge I decided to build a PSOne emulator in JavaScript. Keep in mind it is a work in progress but at this point it is good enough to publish.

# How to run

First clone or download the repo then open the index.html in the distfolder. or visit [latest](https://kootstra-rene.github.io/enge-js/)
Note you'll need chrome for running this emulator.

## Loading the BIOS

When the emulator is running and no BIOS has been loaded the eNGE logo will be pulsating with a red color.
You can load the BIOS by dragging and dropping a PSX BIOS file (SCHP1001) on the emulator page. If all went well the eNGE logo stops pulsating. If you press F5 or everythime you start the emulator again it will use the previous loaded BIOS.

## Loading a demo
Same as with the BIOS drag and drop the .psx-exe file on the emulator page and it will automatically start running

## Loading a cdrom
Same as with the BIOS drag and drop the .bin file on the emulator page and it will automatically start running. Only raw .iso and .bin files are supported currently.

## Controls

q = L2  
w = L1  
e = triangle  
r = R1  
t = R2  
s = square  
d = circle  
x = x  
space = select  
enter = start  

## Handy info
Double clicking the emulator page will stop/resume the emulator. This can be handy when the sound is really crappy.

## Memory Card
Totally not supported at this time

# Which game run

I haven't extensivly tested but SCARS, Spyro, Final Fantasy VII seem te be running just fine.
