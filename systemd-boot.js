const fs = require('fs')
const {join, resolve, basename} = require('path')

const pull = require('pull-stream')
const pullFile = require('pull-file')
const pullSplit = require('pull-split')

module.exports = {
  parseConfig,
  parseEntries,
  autoDetect
}

function autoDetect(boot, cb) {
  const configFile = join(boot, 'loader', 'loader.conf')
  if (!fs.existsSync(configFile)) {
    return cb(null, false)
  }
  const ret = {
    'boot-config': configFile
  }
  const entriesDir = join(boot, 'loader', 'entries')
  if (!fs.existsSync(entriesDir)) {
    return cb(null, ret)
  }
  const entryFiles = fs.readdirSync(entriesDir).map(e => join(entriesDir, e))
  ret['boot-entry'] = entryFiles
  parseEntries(entryFiles, (err, entries) => {
    if (err) return cb(err)
    ret.kernel = unique(flatten(Object.values(entries).map(e => e.linux))).map(e => join(boot, e))
    ret.initcpio = unique(flatten(Object.values(entries).map(e => e.initrd))).map(e => join(boot, e))
    cb(null, ret)
  })
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
        let [key, ...value] = kv.split('=')
        value = value.join('=')
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
      const [key, ...value] = line.trim().split(/\s+/)
      return {key, value: value.join(' ').trim()}
    }),
    pull.collect((err, kvs)=>{
      if (err) return cb(err)
      const ret = {}
      for(let {key, value} of kvs) {
        if (ret[key]) {
          if (Array.isArray(ret[key])) {
            ret[key].push(value)
          } else {
            ret[key] = [ret[key], value]
          }
        } else {
          ret[key] = value
        }
      }
      cb(null, ret)
    })
  )
}

// -- util
function flatten(arr) {
  if (!Array.isArray(arr)) return arr
  let ret = []
  for(let e of arr) {
    if (Array.isArray(e)) ret = ret.concat(flatten(e))
    else ret.push(e)
  }
  return ret
}

function unique(arr) {
  return Array.from(new Set(arr))
}
