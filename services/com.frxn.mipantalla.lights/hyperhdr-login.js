'use strict';
var net = require('net');
var MAX_BUFFER = 64 * 1024;

function failure(code) {
  var error = new Error(code);
  error.code = code;
  return error;
}
function validToken(value) {
  return typeof value === 'string' && value.length > 36 && value.length <= 2048 && !/[\x00-\x1f\x7f]/.test(value);
}
// Password login to the local HyperHDR daemon. It is kept apart from hyperhdr-rpc.js so the
// request whitelist there never has to accept a password. Nothing here logs the reply: it holds the token.
module.exports = function login(password, options) {
  options = options || {};
  var timeout = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 3000;
  var factory = options.socketFactory || function (endpoint) { return net.createConnection(endpoint); };
  return new Promise(function (resolve, reject) {
    if (typeof password !== 'string' || !/^[a-f0-9]{48}$/.test(password)) { reject(failure('HYPERHDR_LOGIN_INVALID')); return; }
    var socket, done = false, buffer = Buffer.alloc(0), timer;
    function finish(error, token) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      buffer = Buffer.alloc(0);
      if (socket) { try { socket.destroy(); } catch (ignored) {} }
      if (error) reject(error); else resolve(token);
    }
    timer = setTimeout(function () { finish(failure('HYPERHDR_LOGIN_TIMEOUT')); }, timeout);
    try {
      socket = factory({host:'127.0.0.1', port:19444});
      socket.on('error', function () { finish(failure('HYPERHDR_LOGIN_CONNECTION')); });
      socket.on('close', function () { finish(failure('HYPERHDR_LOGIN_CONNECTION')); });
      socket.on('connect', function () {
        try {
          socket.write(JSON.stringify({command:'authorize', subcommand:'login', password:password, tan:1}) + '\n', 'utf8');
        } catch (ignored) { finish(failure('HYPERHDR_LOGIN_CONNECTION')); }
      });
      socket.on('data', function (bytes) {
        if (done) return;
        if (!Buffer.isBuffer(bytes) || bytes.length + buffer.length > MAX_BUFFER) { finish(failure('HYPERHDR_LOGIN_PROTOCOL')); return; }
        buffer = Buffer.concat([buffer, bytes]);
        var index;
        while (!done && (index = buffer.indexOf(10)) !== -1) {
          var line = buffer.slice(0, index).toString('utf8');
          buffer = buffer.slice(index + 1);
          var reply;
          try { reply = JSON.parse(line); } catch (ignored) { finish(failure('HYPERHDR_LOGIN_PROTOCOL')); return; }
          if (!reply || typeof reply !== 'object' || reply.tan !== 1) continue;
          if (reply.success !== true) { finish(failure('HYPERHDR_LOGIN_REJECTED')); return; }
          if (!reply.info || !validToken(reply.info.token)) { finish(failure('HYPERHDR_LOGIN_PROTOCOL')); return; }
          finish(null, reply.info.token);
        }
      });
    } catch (ignored) { finish(failure('HYPERHDR_LOGIN_CONNECTION')); }
  });
};
module.exports.validToken = validToken;
