# Foreword
It's no secret that with the rise of AI a lot of the software development process has shifted entirely. All of the bug fixes I (ff7man) have made over the few days have been possible with a $20 chatgpt subscription and some dedication. I know I didn't fix every bug in this project, but it is in a substantially better spot. I wanted to share my methodology on how almost anyone could contribute future bug fixes with minimal programming and reverse engineering background. 

# Methodology

Head over to chatgpt.com and purchase the $20 plan. With the $20 plan you will be given accees to the chatgpt app (aka codex) which you should install on your computer. I used an old macbook air m2.

With the app you want to create a project and set the model to GPT6 Luna, while not as smart this model does pretty well and is quite a bit cheaper on usage limits compard to GPT6 Sol. You then want to enable full disk access so you are not constantly prompted to allow commands. If you are sketched out by this get a dedicated machine or virtual machine for this. From here you can ask it questions just as you would on chatgpt.com, but it is allowed to run programs and change files automatically. 

```
can you git clone a copy of https://github.com/kootstra-rene/enge-js? 
it's a javascript playstation emulator I want to make some bug fixes for
```

it'll go and fetch the repo with git and place a copy locally

I then made a rules.md then told chatgpt to follow it. Don't be surprised when the AI forgets to follow a rule it's very nondeterministic. 

Inside my rules.md I put

```
reference how psx emulators should work from:
https://psx-spx.consoledev.net/
and working code in
https://github.com/libretro/pcsx_rearmed and 
https://github.com/stenzek/duckstation

never use any identity besides ff7man

before starting a new browser make sure you have stopped old browsers so we don't have resources dangling

You should use playwright to interact with the browser. Feel free to add code or make changes so we can debug issues.

Only use one browser at a time and show the browser to me so I can help navigate the game and trigger complex issues. 

when making pr's dont update docs/*.js files directly only make changes that can be rebuilt from code/ from build.sh by the maintainer. You can test locally by using the same build script and a docker container to bundle the javascript files.

don't annoy the maintaner of https://github.com/kootstra-rene/enge-js and ask the user to create prs from branches you made and provide them with a link to do so that way they can be human reviewed, make sure to provide a paragraph suggesting your change that can be used as the body of the PR.
```

On my laptop I have the github cli added and configured my identity using a ssh key. I also installed docker desktop. You can ask chatgpt to do this for you too. 

Now finally I tell the AI to use my rules.md

```
Before you make changes I've made a rules.md can you read that and make sure to follow them
```

I then open a terminal, navigate to the project folder.

I made a games folder and put some roms in there and a copy of scph1001.bin

I then start a server with `node server.js`

```
I have started a server for this project on localhost:8000 please use this when doing debugging
```

`I am trying to fix a bug when playing <insert game here> which I have added to the game launcher. I'm noticing <description>. Can you help me investigate?`
for example

`I am trying to fix a bug when playing Brunswick Pro bowling which I have added to the game launcher. I'm noticing it can load the menus, but crashes whenever I actually start a game. Can you help me investigate? I can get the game to the part where it crashes for you.`

It'll modify the code and add web console debug scripts to try and understand what is going on and ask you to try things. 

It's an iterative process from here. You just keep prompting it to try things. You can give it screenshots and audio files. Having a computer science background can really help. The more developer experience you have really helps you ask better questions. If you don't understand something you can have it try and explain.  

When it gets stumped ask it:

`Is there anything we can do to try and understand why it isn't working? Any debug or messages we can add to the emulator? Anything you need a human to help you review?`

You can also remind it:

`there are working playstation emulators out there like psx rearmed and duckstation, can we learn from them?`

Most cases AI has been pretty good about finding a fix in less than 10 min. 

When you finally get a fix:

```
Why did that work and can you help me make a PR for this? 
```

Finally when you get the PR make sure you aren't making a ton of commits or changing a ton of files we want to make small iterative changes. Try and understand what it did to fix the issue. Do you think this will break compatibility with some other games or overall make things better? That's a hard call to make and the maintainer of the repo will need to make a judgement call if what you did was helpful. Make sure you aren't changing anything in docs/*.js and provide some human input to this process. Make smaller fixes with a smaller number of commits if possible. No one likes talking to an AI be a human. 

If you make multiple commits and the website says you have conflicts ask the ai to fix them.

`Hi I'm trying to merge <this> but it says there is a merge conflict can you resolve it? When done tell me where you put it on disk so I can go and test the change works properly.`
