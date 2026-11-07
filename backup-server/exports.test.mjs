import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('const readableExportCache ='),html.indexOf('async function _attemptAutoBackup()'));
test('exports skip unchanged lists, upload edits, and retry failures with bounded concurrency',async()=>{
 const context=vm.createContext({crypto:webcrypto,TextEncoder,Uint8Array,lists:Array.from({length:6},(_,id)=>({id,name:'List'+id,text:'original'})),safeFilename:x=>x,listToText:x=>x.text,listToHTML:x=>x.text});
 vm.runInContext(source,context);
 let active=0,max=0,calls=[];
 const upload=async(name)=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));calls.push(name);active--;};
 await context.uploadReadableExports('drive',upload);assert.equal(calls.length,12);assert(max<=3);
 calls=[];await context.uploadReadableExports('drive',upload);assert.equal(calls.length,0);
 context.lists[0].text='changed';await context.uploadReadableExports('drive',upload);assert.deepEqual(calls,['List0.txt','List0.html']);
 context.lists[0].text='retry';let failures=0;
 await assert.rejects(context.uploadReadableExports('drive',async()=>{failures++;throw Error('offline');}));assert.equal(failures,1);
 calls=[];await context.uploadReadableExports('drive',upload);assert.deepEqual(calls,['List0.txt','List0.html']);
});
