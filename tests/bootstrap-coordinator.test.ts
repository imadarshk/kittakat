import test from 'node:test';
import assert from 'node:assert/strict';
import { createBootstrapCoordinator } from '../lib/bootstrap-coordinator.ts';

function deferred<T>() {
  let resolve!: (value:T) => void;
  let reject!: (reason:Error) => void;
  const promise = new Promise<T>((yes,no) => { resolve=yes; reject=no; });
  return { promise, resolve, reject };
}

test('a background refresh cannot overtake an explicit space switch', async () => {
  const target = deferred<string>();
  const applied:string[]=[];
  const loaded:string[]=[];
  const coordinator=createBootstrapCoordinator(async id => {
    loaded.push(id!);
    return id==='B'?target.promise:'A';
  }, value => applied.push(value));
  await coordinator.refresh('A');
  const switching=coordinator.switchSpace('B');
  const background=coordinator.refresh('A');
  target.resolve('B');
  assert.equal(await switching,true);
  assert.equal(await background,false);
  assert.deepEqual(loaded,['A','B']);
  assert.deepEqual(applied,['A','B']);
});

test('an earlier in-flight refresh cannot replace the selected space', async () => {
  const old=deferred<string>();
  const next=deferred<string>();
  const applied:string[]=[];
  const coordinator=createBootstrapCoordinator(id=>id==='A'?old.promise:next.promise,value=>applied.push(value));
  const background=coordinator.refresh('A');
  const switching=coordinator.switchSpace('B');
  next.resolve('B');
  assert.equal(await switching,true);
  old.resolve('A');
  assert.equal(await background,false);
  assert.deepEqual(applied,['B']);
});

test('overlapping explicit switches do not replace the requested destination', async () => {
  const target=deferred<string>();
  const applied:string[]=[];
  const loaded:string[]=[];
  const coordinator=createBootstrapCoordinator(async id=>{loaded.push(id!);return id==='B'?target.promise:'C';},value=>applied.push(value));
  const switching=coordinator.switchSpace('B');
  const duplicate=coordinator.switchSpace('C');
  target.resolve('B');
  assert.equal(await duplicate,false);
  assert.equal(await switching,true);
  assert.deepEqual(loaded,['B']);
  assert.deepEqual(applied,['B']);
});

test('a failed switch preserves the current space and permits future refreshes', async () => {
  const target=deferred<string>();
  const applied:string[]=[];
  const coordinator=createBootstrapCoordinator(async id=>id==='B'?target.promise:'A',value=>applied.push(value));
  await coordinator.refresh('A');
  const switching=coordinator.switchSpace('B');
  target.reject(new Error('Space unavailable'));
  await assert.rejects(switching,/Space unavailable/);
  assert.deepEqual(applied,['A']);
  assert.equal(await coordinator.refresh('A'),true);
  assert.deepEqual(applied,['A','A']);
});

test('a successful logout refresh supersedes a pending authenticated space switch', async () => {
  const space=deferred<string>();
  const auth=deferred<string>();
  const applied:string[]=[];
  const coordinator=createBootstrapCoordinator(id=>id==='B'?space.promise:auth.promise,value=>applied.push(value));
  const switching=coordinator.switchSpace('B');
  const signedOut=coordinator.refresh(undefined,'auth');
  auth.resolve('signed out');
  assert.equal(await signedOut,true);
  space.resolve('stale signed-in B');
  assert.equal(await switching,false);
  assert.deepEqual(applied,['signed out']);
});

test('an obsolete switch cannot unlock an authentication refresh still in flight', async () => {
  const space=deferred<string>();
  const auth=deferred<string>();
  const applied:string[]=[];
  const loaded:(string|undefined)[]=[];
  const coordinator=createBootstrapCoordinator(async id=>{loaded.push(id);return id==='B'?space.promise:auth.promise;},value=>applied.push(value));
  const switching=coordinator.switchSpace('B');
  const signedOut=coordinator.refresh(undefined,'auth');
  space.resolve('stale signed-in B');
  assert.equal(await switching,false);
  assert.equal(await coordinator.refresh('A'),false);
  assert.equal(await coordinator.switchSpace('C'),false);
  auth.resolve('signed out');
  assert.equal(await signedOut,true);
  assert.deepEqual(loaded,['B',undefined]);
  assert.deepEqual(applied,['signed out']);
});
