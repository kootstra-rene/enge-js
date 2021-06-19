function readStorageStream(item, handler) {
  const base64text = localStorage.getItem(item);
  if (base64text) {
    const arrayBuffer = Base64.decode(base64text);
    return handler(arrayBuffer);
  }
  else {
    return handler(null);
  }
}

function writeStorageStream(item, arrayBuffer) {
  const base64text = Base64.encode(arrayBuffer);
  localStorage.setItem(item, base64text);
}

const settings = (() => {
  let object = JSON.parse(localStorage.getItem('config') || '{"quality": 1}');
  if (object.naiveResolutionImprovement === undefined) object.naiveResolutionImprovement = true;
  return object;
})();


settings.updateQuality = update => {
  const elem = document.getElementById('quality');

  if (update) {
    settings.quality <<= 1;
    if (settings.quality > 8) settings.quality = 1;

    localStorage.setItem('config', JSON.stringify(settings));
    elem.classList.add('restart');
  }

  elem.innerText = `Q${settings.quality}`;
}