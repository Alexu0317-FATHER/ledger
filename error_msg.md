D:\AI AND ME\projects\记账本\wechat-processor.js:65
            .on('data', (data) => results.push(data))
                                          ^

ReferenceError: results is not defined
    at CsvParser.<anonymous> (D:\AI AND ME\projects\记账本\wechat-processor.js:65:43)
    at CsvParser.emit (node:events:518:28)
    at addChunk (node:internal/streams/readable:561:12)
    at readableAddChunkPushObjectMode (node:internal/streams/readable:538:3)
    at Readable.push (node:internal/streams/readable:393:5)
    at CsvParser.writeRow (D:\AI AND ME\projects\记账本\node_modules\csv-parser\index.js:200:12)
    at CsvParser.parseLine (D:\AI AND ME\projects\记账本\node_modules\csv-parser\index.js:170:14)
    at CsvParser._transform (D:\AI AND ME\projects\记账本\node_modules\csv-parser\index.js:262:16)
    at Transform._write (node:internal/streams/transform:171:8)
    at writeOrBuffer (node:internal/streams/writable:572:12)

Node.js v22.14.0