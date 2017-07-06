const fs = require('fs');
const Transform = require('stream').Transform;

const makePrettyJsonFile = (inputFileName, outputFileName) => {
  let isBegin = true;
  const parser = new Transform({
    transform : function (data, _, done) {
      const stringData = data.toString('utf8');
      const prefix = isBegin? '[\n': '';
      isBegin = false;
      const awesomeData = prefix.concat(stringData.replace(/}\s*{/g, '},\n{'));
      this.push(awesomeData, 'utf8');
      done();
    },
    flush : function (callback) {
      this.push(']');
      callback();
    }

  });
  const rs = fs.createReadStream(inputFileName, 'utf8');
  const ws = fs.createWriteStream(outputFileName, 'utf8');
  ws.on('finish', () => {
    console.log('done');
  })
  rs.pipe(parser).pipe(ws);
}

module.exports = makePrettyJsonFile;

