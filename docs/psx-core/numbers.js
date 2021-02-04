'use strict';

Number.prototype.asInt8 = function() {
  return (this.valueOf() << 24) >> 24;
}
Number.prototype.asInt16 = function() {
  return (this.valueOf() << 16) >> 16;
}
Number.prototype.asInt32 = function() {
  return (this.valueOf() << 0) >> 0;
}

//Number.MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER || +(Math.pow(2, 53) - 1)
//Number.MIN_SAFE_INTEGER = Number.MIN_SAFE_INTEGER || -(Math.pow(2, 53) - 1)

Number.prototype.isSafe = function() {return
  var self = this.valueOf();
  if (self !== Math.floor(self)) abort('not an integer: '+this)
  if (self < Number.MIN_SAFE_INTEGER) abort('losing precision')
  if (self > Number.MAX_SAFE_INTEGER) abort('losing precision')
}

