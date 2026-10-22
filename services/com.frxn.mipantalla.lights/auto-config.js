'use strict';
var nodeFs = require('fs');

var ROOT = '/var/lib/mipantalla-maintenance/auto-sync';
// Allow-list only: DRM apps (Netflix, Disney+) probably hand the capturer black frames, so they stay out until tested.
var APPS = ['youtube.leanback.v4'];
var LIMIT = 4096;
var STATES = ['off', 'idle', 'waiting', 'syncing', 'stopping', 'error'];
var FRESH_MS = 90000;

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

// Root-owned, private files shared by the lights service (writes the switch, reads the status) and the
// auto-sync watcher (reads the switch, writes the status). Nothing in them is secret, but nobody else may edit them.
module.exports = function createAutoConfig(options) {
  options = options || {};
  var fs = options.fs || nodeFs;
  var root = options.root || ROOT;
  var uid = options.uid !== undefined ? options.uid : (typeof process.getuid === 'function' ? process.getuid() : -1);
  var now = options.now || Date.now;
  var random = options.random || function () { return require('crypto').randomBytes(8).toString('hex'); };
  var configFile = root + '/config.json', stateFile = root + '/state.json';

  function unsafe() { var error = new Error('AUTO_FILE_UNSAFE'); error.code = 'AUTO_FILE_UNSAFE'; return error; }
  function ensureDirectory() {
    if (uid !== 0) throw unsafe();
    try { fs.mkdirSync(root, 448); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    var stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 511) !== 448) throw unsafe();
  }
  function read(file) {
    var stat;
    try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > LIMIT || stat.uid !== 0 || (stat.mode & 511) !== 384) throw unsafe();
    var fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      var actual = fs.fstatSync(fd);
      if (actual.ino !== stat.ino || actual.dev !== stat.dev) throw unsafe();
      return JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally { fs.closeSync(fd); }
  }
  function write(file, value) {
    ensureDirectory();
    var temporary = file + '.' + random() + '.tmp';
    var fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 384);
    try {
      try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, file);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch (ignored) {}
      throw error;
    }
  }
  function readConfig() {
    var value;
    try { value = read(configFile); } catch (error) { return {enabled:false, invalid:true}; }
    if (value === null) return {enabled:false, invalid:false};
    if (!object(value) || typeof value.enabled !== 'boolean' || Object.keys(value).length !== 1) return {enabled:false, invalid:true};
    return {enabled:value.enabled, invalid:false};
  }
  function writeConfig(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('AUTO_INVALID');
    write(configFile, {enabled:enabled});
    return {enabled:enabled};
  }
  function readState() {
    var value;
    try { value = read(stateFile); } catch (error) { return null; }
    if (!object(value) || STATES.indexOf(value.state) === -1 || typeof value.updatedAt !== 'number' ||
        !(value.pid === null || (typeof value.pid === 'number' && value.pid > 1)) || typeof value.autoStarted !== 'boolean') return null;
    return {
      state:value.state, app:typeof value.app === 'string' && value.app.length <= 128 ? value.app : null,
      reason:typeof value.reason === 'string' ? value.reason.slice(0, 60) : '', autoStarted:value.autoStarted,
      pid:value.pid, updatedAt:value.updatedAt
    };
  }
  function writeState(value) {
    if (!object(value) || STATES.indexOf(value.state) === -1) throw new Error('AUTO_INVALID');
    write(stateFile, {
      state:value.state, app:typeof value.app === 'string' ? value.app.slice(0, 128) : null,
      reason:typeof value.reason === 'string' ? value.reason.slice(0, 60) : '', autoStarted:value.autoStarted === true,
      pid:typeof value.pid === 'number' ? value.pid : null, updatedAt:now()
    });
  }
  function watching(state) {
    return !!state && state.state !== 'off' && state.pid !== null && now() - state.updatedAt < FRESH_MS;
  }
  function available() { return uid === 0; }
  return {APPS:APPS, available:available, readConfig:readConfig, writeConfig:writeConfig, readState:readState, writeState:writeState,
    watching:watching, FRESH_MS:FRESH_MS, root:root};
};
module.exports.APPS = APPS;
