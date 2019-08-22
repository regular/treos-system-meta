#!/usr/bin/env node
const fs = require('fs')
const {join, resolve, basename} = require('path')
const merge = require('lodash.merge')
const multicb = require('multicb')
const argv = require('minimist')(process.argv.slice(2))

const pull = require('pull-stream')
const paramap = require('pull-paramap')
const pullFile = require('pull-file')
const pullSplit = require('pull-split')
const {execFile} = require('child_process')
const systemdboot = require('../systemd-boot')

let kernelFiles = arr(argv.kernel)
let cpioFiles = arr(argv.initcpio)
let bootConfig = argv['boot-config']
let bootEntries = arr(argv['boot-entry'])

const imageFiles = arr(argv['disk-image'])
const shrinkwrapFile = argv.shrinkwrap

const bootDir = argv['auto-detect']
if (bootDir) {
  systemdboot.autoDetect(bootDir, (err, result) => {
    if (err) {
      console.error(err.message)
      process.exit(1)
    }
    if (!result) {
      console.error('Failed to auto-detect boot entries')
      process.exit(1)
    }
    bootConfig = result['boot-config']
    bootEntries = bootEntries.concat(result['boot-entry'])
    kernelFiles = kernelFiles.concat(result.kernel)
    cpioFiles = cpioFiles.concat(result.initcpio)
    doAll(kernelFiles, cpioFiles, bootConfig, bootEntries, imageFiles, shrinkwrapFile)
  })
} else {
  doAll(kernelFiles, cpioFiles, bootConfig, bootEntries, imageFiles, shrinkwrapFile)
}

function doAll(kernelFiles, cpioFiles, bootConfig, bootEntries, imageFiles, shrinkwrapFile) {
  const files = kernelFiles.concat(cpioFiles).concat(imageFiles)
  if (shrinkwrapFile) files.push(shrinkwrapFile)

  getFileInfo(files, (err, info)=>{
    if (err) return console.error(err.message)

    const kernels = kernelFiles.reduce((a,p) =>{
      const i = info[p]
      a[basename(p)] = {
        description: i.type,
        size: i.stat.size,
        checksum: i.sum
      }
      return a
    }, {})

    const initcpios = cpioFiles.reduce((a,p) =>{
      const i = info[p]
      a[basename(p)] = {
        description: i.type,
        size: i.stat.size,
        checksum: i.sum
      }
      return a
    }, {})

    const diskImages = imageFiles.reduce((a,p) =>{
      const i = info[p]
      a[basename(p)] = {
        description: i.type,
        size: i.stat.size,
        checksum: i.sum
      }
      return a
    }, {})

    let shrinkwrap = null

    const done = multicb({pluck: 1})

    handleBootEntries(bootEntries, done())

    if (shrinkwrapFile) {
      shrinkwrap = info[shrinkwrapFile].sum
      const cb = done()
      parseSkrinkwrapFile(shrinkwrapFile, (err, result) => {
        if (err) return cb(err)
        return cb(null, {packages: result})
      })
    }

    if (bootConfig) {
      const cb = done()
      systemdboot.parseConfig(bootConfig, (err, result)=>{
        if (err) return cb(err)
        cb(null, {bootloader: {config: result}})
      })
    }
    
    done( (err, results)=>{
      if (err) {
        console.error(err.message)
        process.exit(1)
      }
      results.unshift({
        kernels,
        initcpios,
        diskImages,
        shrinkwrap
      })
      const result = merge(...results)
      console.log(JSON.stringify(result, null, 2))
    })
    
  })
}

// -- util

function handleBootEntries(bootEntries, cb) {
  systemdboot.parseEntries(bootEntries, (err, entries) => {
    if (err) return cb(err)
    for(let entry of Object.values(entries)) {
      if (entry.options && entry.options['tre-invite']) {
        entry.options['tre-invite'] = '$TRE_INVITE'
      }
    }
    cb(null, {bootloader: {entries}})
  })
}
function parseSkrinkwrapFile(shrinkwrapFile, cb) {
  const packages = {}
  pull(
    pullFile(shrinkwrapFile),
    pullSplit(),
    pull.map(line=>{
      const [ssbkey, type, name, version] = line.split(' ')
      return {type, name, version}
    }),
    pull.filter( ({type})=>type == 'explicit'),
    pull.drain( ({name, version})=>{
      packages[name] = version
    }, err => {
      if (err) return cb(err)
      cb(null, packages)
    })
  )
}

function getFileInfo(files, cb) {
  pull(
    pull.values(files),
    paramap(fileInfo, 4),
    pull.reduce((r, x)=>{
      r[x.path] = x
      return r
    }, {}, cb)
  )
}

function fileInfo(file, cb) {
  const done = multicb({pluck: 1, spread: true})
  fs.stat(file, done())
  sha256(file, done())
  fileType(file, done())
  done((err, stat, sum, type)=>{
    if (err) return cb(err)
    return cb(null, {path: file, stat, sum, type})
  })
}

function sha256(file, cb) {
  const child = execFile('sha256sum', [
    '-b',
    file
  ], (err, stdout, stderr) => {
    if (err) return cb(err)
    cb(null, Buffer.from(stdout, 'hex').toString('base64')+'.sha256')
  })
}

function fileType(file, cb) {
  const child = execFile('file', [
    '--brief',
    file
  ], (err, stdout, stderr) => {
    if (err) return cb(err)
    cb(null, stdout.trim())
  })
}

function arr(x) {
  if (!x) return []
  if (Array.isArray(x)) return x
  return [x]
}
