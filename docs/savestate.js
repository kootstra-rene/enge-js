class SaveState {

    constructor() {
        this.fullSaveState = {};
        this.saveStateRequested = false;
        this.loadStateRequested = false;
        this.CreateDB();
    }

    RequestSaveState() {
        this.saveStateRequested = true;
    }

    RequestLoadState() {
        this.loadStateRequested = true;
    }

    SaveAll() {
        this.SaveObject(cpu, "cpu");
        this.SaveObject(cdr, "cdr");
        this.SaveObject(dma, "dma");
        this.SaveObject(gte, "gte");
        this.SaveObject(gpu, "gpu");
        this.SaveObject(video, "video");
        this.SaveObject(mdc, "mdc");
        this.SaveObject(state, "state");
        this.SaveObject(rc0, "rc0");
        this.SaveObject(rc1, "rc1");
        this.SaveObject(rc2, "rc2");
        this.SaveObject(dot, "dot");
        this.SaveObject(joy, "joy");
        this.SaveObject(spu, "spu");
        this.SaveObject(psx, "psx");

        this.fullSaveState["map"] = new Int32Array(map.length);
        for (let i = 0; i < map.length; i++)
            this.fullSaveState["map"][i] = map[i];

        //direct objects
        // this.SaveDirect(map,"map");
        // this.SaveDirect(xa2flt,"xa2flt");
        // this.SaveDirect(xa2pcm,"xa2pcm");
    }

    LoadAll() {
        this.LoadObject(cpu, "cpu");
        this.LoadObject(cdr, "cdr");
        this.LoadObject(dma, "dma");
        this.LoadObject(gte, "gte");
        this.LoadObject(gpu, "gpu");
        this.LoadObject(video, "video");
        this.LoadObject(mdc, "mdc");
        this.LoadObject(state, "state");
        this.LoadObject(rc0, "rc0");
        this.LoadObject(rc1, "rc1");
        this.LoadObject(rc2, "rc2");
        this.LoadObject(dot, "dot");
        this.LoadObject(joy, "joy");
        this.LoadObject(spu, "spu");
        this.LoadObject(psx, "psx");

        for (let i = 0; i < map.length; i++)
            map[i] = this.fullSaveState["map"][i];

        // map = this.fullSaveState["map"];
        // map8 = new Int8Array(map.buffer);
        // map16 = new Int16Array(map.buffer);
        //direct objects
        // this.LoadDirect(map,"map");
        // this.LoadDirect(xa2flt,"xa2flt");
        // this.LoadDirect(xa2pcm,"xa2pcm");

        window["saveState"].ShowOverlayMessage('State Loaded');
    }

    SaveToDatabase() {
        this.SaveAll();
        let full = this.fullSaveState;
        var request = indexedDB.open('PSX_DB');

        request.onsuccess = function (ev) {
            var db = ev.target.result;
            var romStore = db.transaction("PSX_SaveStates", "readwrite").objectStore("PSX_SaveStates");
            var addRequest = romStore.put(full, fileName + '.sav');
            addRequest.onsuccess = function (event) {
                console.log('data added');
                window["saveState"].ShowOverlayMessage('State Saved');
            };
            addRequest.onerror = function (event) {
                console.log('error adding data');
                console.log(event);
                window["saveState"].ShowOverlayMessage('Error Saving');
            };
        };
    }

    LoadFromDatabase() {
        var request = indexedDB.open('PSX_DB');
        
        request.onsuccess = function (ev) {
            var db = ev.target.result;
            var romStore = db.transaction("PSX_SaveStates", "readwrite").objectStore("PSX_SaveStates");
            var rom = romStore.get(fileName + '.sav');
            rom.onsuccess = function (event) {
                if (rom.result == null || rom.result == undefined) {
                    window["saveState"].ShowOverlayMessage('No Save State Found');
                }
                else {
                    let saveStateData = rom.result;
                    console.log('data pulled from db');
                    window["loadSavState"] = saveStateData;
                }
            };
            rom.onerror = function (event) {
                console.log('error getting save state data from store');
                window["saveState"].ShowOverlayMessage('Error Loading');
            };
        };
        request.onerror = function (ev) {
            console.log('error loading db');
        };
    }

    LoadDirect(obj, name) {
        obj = this.fullSaveState[name];
    }

    LoadObject(obj, name) {
        for (let [key, value] of Object.entries(this.fullSaveState[name])) {
            obj[key] = value;
        }
    }

    SaveDirect(obj, name) {
        this.fullSaveState[name] = obj;
    }

    SaveObject(obj, name) {
        let subObject = {};
        // console.log('Saving ' + name + '...');

        for (let [key, value] of Object.entries(obj)) {

            if (typeof value == "boolean" ||
                typeof value == "number" ||
                typeof value == "object" ||
                typeof value == "string") {

                let toSave = true;

                if (key == "cdImage" ||
                    key == "events" ||
                    key == "voices" ||
                    key == "devices" ||
                    key == "handlers")
                    toSave = false;
                else if (typeof value == "object") {

                    toSave = false;

                    if (key == "config" ||
                        key == "filter" ||
                        key == "currTrack") {
                        toSave = true;
                    }
                    if (value.constructor == Uint32Array) {
                        subObject[key] = new Uint32Array(value.length);
                        for (let i = 0; i < value.length; i++)
                            subObject[key][i] = value[i];
                    }
                    if (value.constructor == Int32Array) {
                        subObject[key] = new Int32Array(value.length);
                        for (let i = 0; i < value.length; i++)
                            subObject[key][i] = value[i];
                    }
                    if (value.constructor == Int8Array) {
                        subObject[key] = new Int8Array(value.length);
                        for (let i = 0; i < value.length; i++)
                            subObject[key][i] = value[i];
                    }
                    if (value.constructor == Array) {
                        subObject[key] = new Array(value.length);
                        for (let i = 0; i < value.length; i++)
                            subObject[key][i] = value[i];
                    }
                    if (value.constructor == Float32Array) {
                        subObject[key] = new Float32Array(value.length);
                        for (let i = 0; i < value.length; i++)
                            subObject[key][i] = value[i];
                    }
                    if (value.constructor == Float64Array) {
                        subObject[key] = new Float64Array(value.length);
                        for (let i = 0; i < value.length; i++)
                            subObject[key][i] = value[i];
                    }
                    if (value.constructor == Uint16Array) {
                        subObject[key] = new Uint16Array(value.length);
                        for (let i = 0; i < value.length; i++)
                            subObject[key][i] = value[i];
                    }
                    if (value.constructor == Int32Array) {
                        subObject[key] = new Int32Array(value.length);
                        for (let i = 0; i < value.length; i++)
                            subObject[key][i] = value[i];
                    }
                }
                if (toSave)
                    subObject[key] = value;
            }
        }

        this.fullSaveState[name] = subObject;
    }

    CreateDB() {

        //if browser doesn't support IndexedDB
        if (window["indexedDB"] == undefined) {
            console.log('indexedDB not available');
            return;
        }

        var request = indexedDB.open('PSX_DB');
        request.onupgradeneeded = function (ev) {
            console.log('upgrade needed');
            let db = ev.target.result;
            let objectStore = db.createObjectStore('PSX_SaveStates', { autoIncrement: true });
            objectStore.transaction.oncomplete = function (event) {
                console.log('db created');
            };
        };

        request.onsuccess = function (ev) {
            var db = ev.target.result;
            var romStore = db.transaction("PSX_SaveStates", "readwrite").objectStore("PSX_SaveStates");
            let allSaveStates = [];
            try {
                romStore.openCursor().onsuccess = function (ev) {
                    var cursor = ev.target.result;
                    if (cursor) {
                        let rom = cursor.key.toString();
                        // console.log('Found: ' + rom);
                        allSaveStates.push(rom);
                        cursor.continue();
                    }
                    else {
                        //end of cursor
                        if (allSaveStates.length > 0) {
                        }
                        else {
                            console.log('no save states found');
                        }
                    }
                };
            }
            catch (error) {
                console.log('error reading keys');
                console.log(error);
            }
        };
    }

    ShowOverlayMessage(text) {
        document.getElementById('textOverlayDiv').innerText = text;
        document.getElementById('textOverlayDiv').style.display = 'block';
        setTimeout(() => {
            document.getElementById('textOverlayDiv').style.display = 'none';
        }, 1000);
    }

    processSaveStates() {
        if (this.saveStateRequested) {
            this.SaveToDatabase();
            this.saveStateRequested = false;
        }
        if (this.loadStateRequested) {
            this.LoadFromDatabase();
            this.loadStateRequested = false;
        }
        if (window["loadSavState"] != null) {
            window["saveState"].fullSaveState = window["loadSavState"];
            window["loadSavState"] = null;
            this.LoadAll();
        }
    }
}