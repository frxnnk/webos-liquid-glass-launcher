'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const file = path.join(__dirname, '../installer/transport.cjs');
const api = fs.existsSync(file) ? require(file) : {};
const host = ['10', '23', '45', '67'].join('.');
const config = {host, identity: process.execPath};
function child() {
  const process = new EventEmitter();
  process.stdin = new PassThrough(); process.stdout = new PassThrough(); process.stderr = new PassThrough();
  process.kill = signal => { process.killedWith = signal; };
  return process;
}

test('exports the bounded asynchronous SSH transport', () => {
  assert.equal(typeof api.createTransport, 'function');
  assert.equal(typeof api.runRemote, 'function');
});

test('accepts only literal canonical private IPv4 and a regular identity file', () => {
  for (const value of ['127.0.0.1', '8.8.8.8', 'tv.local', '-oProxyCommand=evil', '10.1.1.1;id', '10.01.1.1', '172.32.1.1', '10.1.1.256']) {
    assert.throws(() => api.createTransport({...config, host: value}));
  }
  for (const value of [['10','0','0','1'], ['172','16','0','1'], ['172','31','255','254'], ['192','168','1','2']]) {
    assert.doesNotThrow(() => api.createTransport({...config, host: value.join('.')}));
  }
  for (const value of ['', '-oSomething', 'missing-private-identity', 'key\nfile']) {
    assert.throws(() => api.createTransport({...config, identity: value}));
  }
  assert.throws(() => api.createTransport({...config, identity: __dirname}));
  for (const port of [0, 65536, '22;id', 1.5]) assert.throws(() => api.createTransport({...config, port}));
});

test('sends fixed LF script on stdin with strict root SSH and no shell interpolation', async () => {
  let proc;
  const transport = api.createTransport(config, {spawn(command, args, options) {
    assert.equal(command, 'ssh'); assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    assert.ok(args.includes('StrictHostKeyChecking=yes')); assert.ok(args.includes('BatchMode=yes'));
    assert.ok(args.includes('IdentitiesOnly=yes')); assert.ok(args.includes(config.identity));
    assert.deepEqual(args.slice(-2), ['root@' + host, 'sh -s']);
    proc = child(); let input = '';
    proc.stdin.on('data', data => { input += data; });
    proc.stdin.on('finish', () => {
      assert.equal(input, "printf 'fixed'\n");
      proc.stdout.write('fixed'); proc.stderr.write('private details'); proc.emit('close', 0);
    });
    return proc;
  }});
  assert.deepEqual(await transport.runRemote("printf 'fixed'\r\n"), {stdout: 'fixed'});
});

test('SSH failure and spawn errors never disclose raw stderr, host or identity', async () => {
  for (const kind of ['exit', 'error']) {
    const transport = api.createTransport(config, {spawn() {
      const proc = child();
      queueMicrotask(() => {
        proc.stderr.write(config.identity + host + ' SECRET');
        if (kind === 'error') proc.emit('error', Error('SECRET ' + config.identity)); else proc.emit('close', 255);
      }); return proc;
    }});
    await assert.rejects(transport.runRemote('id -u\n'), error => !error.message.includes(config.identity) && !error.message.includes(host) && !error.message.includes('SECRET'));
  }
});

test('deadline kills SSH and rejects once instead of waiting indefinitely', async () => {
  let proc;
  const transport = api.createTransport(config, {spawn() { proc = child(); return proc; }});
  await assert.rejects(transport.runRemote('id -u\n', {timeoutMs: 15}), /tiempo|timeout/i);
  assert.equal(proc.killedWith, 'SIGKILL');
  proc.emit('close', 0);
});

test('combined output is capped at 20 MiB and the process is killed', async () => {
  let proc;
  const transport = api.createTransport(config, {spawn() {
    proc = child(); queueMicrotask(() => proc.stdout.write(Buffer.alloc(20 * 1024 * 1024 + 1))); return proc;
  }});
  await assert.rejects(transport.runRemote('id -u\n'), /límite|limit/i);
  assert.equal(proc.killedWith, 'SIGKILL');
});

test('invalid scripts and deadlines beyond the bounded capture budget are rejected before spawning', async () => {
  let calls = 0;
  const transport = api.createTransport(config, {spawn() { calls++; return child(); }});
  for (const script of ['', 'a\0b', Buffer.from('not a string')]) await assert.rejects(transport.runRemote(script));
  for (const timeoutMs of [0, 25001, Infinity]) await assert.rejects(transport.runRemote('id -u\n', {timeoutMs}));
  assert.equal(calls, 0);
});

test('an explicit 25-second capture budget is accepted without changing strict SSH connection options',async()=>{
  let calls=0;
  const transport=api.createTransport(config,{spawn(command,args){
    calls++;assert.ok(args.includes('ConnectTimeout=8'));const proc=child();
    queueMicrotask(()=>{proc.stdout.write('complete');proc.emit('close',0);});return proc;
  }});
  assert.deepEqual(await transport.runRemote('capture-test\n',{timeoutMs:25000}),{stdout:'complete'});
  assert.equal(calls,1);
});

test('stderr contributes to the same output budget and is never returned', async () => {
  let proc;
  const transport = api.createTransport(config, {spawn() {
    proc = child(); queueMicrotask(() => {
      proc.stdout.write(Buffer.alloc(10 * 1024 * 1024));
      proc.stderr.write(Buffer.alloc(10 * 1024 * 1024 + 1));
    }); return proc;
  }});
  await assert.rejects(transport.runRemote('id -u\n'), /límite|limit/i);
  assert.equal(proc.killedWith, 'SIGKILL');
});
