# Why this emulator
Everybody said you can't run a PSone emulator in JavaScript at full speed in the browser. It's too slow...
You have the emscriptem based ones but that is not pure JavaScript and also those emulators don't seem to run at full speed.  So to learn JavaScript and further my programming knowledge I decided to build a PSone emulator in JavaScript. Keep in mind it is a work in progress but at this point it is good enough to publish.

# How to run

Just go to [the latest release](https://kootstra-rene.github.io/enge-js/). Note you'll need chrome for running this emulator and read the rest of this readme before you do.

## Loading the BIOS

When the emulator is running and no BIOS has been loaded the eNGE logo will be pulsating with a red color.
You can load the BIOS by dragging and dropping a PSX BIOS file (SCHP1001) on the emulator page. If all went well the eNGE logo stops pulsating. If you press F5 or everythime you start the emulator again it will use the previous loaded BIOS.

## Loading a demo
Same as with the BIOS drag and drop the .psx-exe file on the emulator page and it will automatically start running

## Loading a cdrom
Same as with the BIOS drag and drop the .bin file on the emulator page and it will automatically start running. Only raw .iso and .bin files are supported currently. The emulator will try to build it's own table of contents a.k.a track information and as such a lot of games have cd audio but it could not work in all cases.

## Improving quality
Clicking the Qx button, toggle between Q1,Q2,Q4 and Q8 the latter being the highest quality. After doing so the border will get an redisch color indicating that you have to restart the emulator which can be done by reloading the page.

## Controls

When using the keyboard:  
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

When using the gamepad just connect it, press a button on the gamepad and the border around the gamepad/keyboardicon should become blueish and you are ready to go.

## Handy info
Double clicking the emulator page will stop/resume the emulator. This can be handy when the sound is really crappy.

## Memory Card
Only one memory card is supported at this time. You can load it the same as the BIOS or CD

# Which games run

I have started a [compatibility list](./compatability.md). So feel free to update it.
