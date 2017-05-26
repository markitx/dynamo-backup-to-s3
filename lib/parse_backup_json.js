const fs = require('fs');

const readFilePromise = fileName => new Promise((res, rej) => {
  fs.readFile(fileName, 'utf8', (err, resp) => err? rej(err): res(resp));
})

const writeFilePromise = (fileName, data) => new Promise((res, rej) => {
  fs.writeFile(fileName, data, 'utf8', err => err? rej(err): res());
});


const readInvalidJson = fileName => readFilePromise(fileName);

const makePrettyJsonFile = (inputFileName, outputFileName) => 
  readInvalidJson(inputFileName)
    .then(data => data.replace(/\n/g, ''))
    .then(data => data.replace(/}\s*{/g, '},{'))
    .then(data => `[${data}]`)
    .then(data => JSON.parse(data))
    .then(data => writeFilePromise(outputFileName, JSON.stringify(data, null, 2)));

module.exports = makePrettyJsonFile;
