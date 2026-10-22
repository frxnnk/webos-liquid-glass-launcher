'use strict';
var nodeFs = require('fs');
var nodeLogin = require('./hyperhdr-login');

var CREDENTIALS = '/var/lib/mipantalla-maintenance/screen/credentials.json';
var LIMIT = 16384;

function failure(code) {
  var error = new Error(code);
  error.code = code;
  return error;
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

// Renews the HyperHDR user token when the daemon restarted and the stored one stopped working.
// HyperHDR 22 regenerates that token on every daemon start, and the PC assistant's
// screen-configure.cjs requires screen-config.token to equal credentials.token (or previousToken),
// so both files change together, credentials first, exactly as that pipeline does.
module.exports = function createRenewer(options) {
  options = options || {};
  var fs = options.fs || nodeFs;
  var login = options.login || nodeLogin;
  var now = options.now || Date.now;
  var uid = options.uid !== undefined ? options.uid : (typeof process.getuid === 'function' ? process.getuid() : -1);
  var credentialsFile = options.credentialsFile || CREDENTIALS;
  var configFile = options.configFile;
  var cooldown = typeof options.cooldownMs === 'number' ? options.cooldownMs : 30000;
  var random = options.random || function () { return require('crypto').randomBytes(8).toString('hex'); };
  var inFlight = null, lastAttempt = -Infinity;

  function read(file) {
    var stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > LIMIT || stat.uid !== 0 || (stat.mode & 511) !== 384) {
      throw failure('RENEW_FILE_UNSAFE');
    }
    var fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      var actual = fs.fstatSync(fd);
      if (actual.ino !== stat.ino || actual.dev !== stat.dev) throw failure('RENEW_FILE_UNSAFE');
      return JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally { fs.closeSync(fd); }
  }
  function save(file, value) {
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
  function renew() {
    var credentials, config;
    try {
      if (uid !== 0 || !configFile) throw failure('RENEW_UNAVAILABLE');
      credentials = read(credentialsFile);
      config = read(configFile);
    } catch (error) {
      return Promise.reject(error && error.code && /^RENEW_/.test(error.code) ? error : failure('RENEW_UNAVAILABLE'));
    }
    if (!object(credentials) || typeof credentials.password !== 'string' || !/^[a-f0-9]{48}$/.test(credentials.password) ||
        credentials.phase !== 'configured' || !Array.isArray(credentials.ids) || !nodeLogin.validToken(credentials.token) ||
        (credentials.previousToken !== undefined && credentials.previousToken !== null) ||
        !object(config) || config.enabled !== true || config.token !== credentials.token) {
      // Anything unexpected is left for the PC assistant: it knows how to recover mid-flow states.
      return Promise.reject(failure('RENEW_STATE_UNEXPECTED'));
    }
    var oldToken = credentials.token;
    return login(credentials.password).then(function (token) {
      if (token === oldToken) return token;
      save(credentialsFile, Object.assign({}, credentials, {previousToken:oldToken, token:token}));
      save(configFile, Object.assign({}, config, {token:token}));
      var finished = Object.assign({}, credentials, {previousToken:null, token:token});
      save(credentialsFile, finished);
      if (read(configFile).token !== token || read(credentialsFile).token !== token) throw failure('RENEW_VERIFY_FAILED');
      return token;
    });
  }
  return {
    renew:function () {
      if (inFlight) return inFlight;
      if (now() - lastAttempt < cooldown) return Promise.reject(failure('RENEW_COOLDOWN'));
      lastAttempt = now();
      inFlight = renew().then(function (token) { inFlight = null; return token; }, function (error) { inFlight = null; throw error; });
      return inFlight;
    }
  };
};
