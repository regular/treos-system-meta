
const {join, resolve, basename} = require('path')

const pull = require('pull-stream')
const pullFile = require('pull-file')
const pullSplit = require('pull-split')

module.exports = {
  parseConfig,
  parseEntries
}

function parseConfig(file, cb) {
  readFile(file, cb)
}

function parseEntry(file, cb) {
  readFile(file, (err, result) => {
    if (err) return cb(err)
    let {options} = result
    if (options) {
      const kvs = options.split(' ')
      result.options = kvs.map(kv => {
        let [key, value] = kv.split('=')
        if (value == '') value = true
        return {key, value}
      }).reduce((acc, {key, value}) => {
        acc[key] = value
        return acc
      }, {})
      cb(null, result)
    }
  })
}

function parseEntries(bootEntries, cb) {
  pull(
    pull.values(bootEntries),
    pull.asyncMap((path, cb) => {
      parseEntry(path, (err, entry) => {
        if (err) return cb(err)
        entry.name = basename(path)
        cb(null, entry)
      })
    }),
    pull.collect( (err, entries)=>{
      if (err) return cb(err)
      entries = entries.reduce( (acc, entry) => {
        acc[entry.name] = entry
        delete entry.name
        return acc
      }, {})
      cb(null, entries)
    })
  )
}
// -- util

function readFile(file, cb) {
  pull(
    pullFile(file),
    pullSplit(),
    pull.filter(line=>line.trim()),
    pull.map(line => {
      const [key, ...value] = line.trim().split(' ')
      return {key, value: value.join(' ').trim()}
    }),
    pull.collect((err, kvs)=>{
      if (err) return cb(err)
      const ret = {}
      for(let {key, value} of kvs) {
        ret[key] = value
      }
      cb(null, ret)
    })
  )
}
