//------------------------------------------------------------------
// Dependencies

var Stream = require('stream')
  , util   = require('util');

//------------------------------------------------------------------
// ReadableStream class

util.inherits(ReadableStream, Stream.Readable);

function ReadableStream (options) {
  this._data = '';
  Stream.Readable.call(this, options);
}

ReadableStream.prototype._read = function(n) {
  var ret = this.push(this._data);
  this._data = '';
  return ret;
};

ReadableStream.prototype.append = function(data) {
  this._data += data;
  this.read(0);
};

ReadableStream.prototype.end = function() {
  this.push(null);
};

//------------------------------------------------------------------
// Exports

module.exports = ReadableStream
