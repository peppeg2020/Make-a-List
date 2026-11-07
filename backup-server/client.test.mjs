import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code=fs.readFileSync(new URL('../drive-connection.js',import.meta.url),'utf8');
function client(){
 const data=new Map([['drive_backend_session','a'.repeat(43)]]),listeners=new Map();let calls=0;
 const popup={location:{},close(){}};
 const context=vm.createContext({localStorage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},window:{open:()=>popup,addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k)},URL,Date,AbortSignal,setTimeout,clearTimeout,fetch:async(url)=>{calls++;return {ok:true,json:async()=>url.endsWith('/connect')?{state:'valid',url:'https://accounts.google.com/auth'}:{access_token:'short-lived',expires_at:Date.now()+3600000}}}});
 vm.runInContext(code+'\nwindow.testClient=new DriveConnection("https://backend.example");',context);
 return {c:context.window.testClient,data,listeners,popup,get calls(){return calls}};
}
test('cached token reuse, force renewal and disconnect',async()=>{
 const f=client();assert.equal(await f.c.token(),'short-lived');await f.c.token();assert.equal(f.calls,1);await f.c.token(true);assert.equal(f.calls,2);await f.c.disconnect();assert(!f.data.has('drive_backend_session'));
});
test('callback rejects wrong origin, window and state before accepting valid response',async()=>{
 const f=client();const pending=f.c.connect();await new Promise(r=>setImmediate(r));const receive=f.listeners.get('message');const event={origin:'https://backend.example',source:f.popup,data:{type:'make-a-list-drive-connected',state:'valid',secret:'b'.repeat(43)}};
 await receive({...event,origin:'https://attacker.example'});await receive({...event,source:{}});await receive({...event,data:{...event.data,state:'wrong'}});assert.equal(f.data.get('drive_backend_session'),'a'.repeat(43));await receive(event);assert.equal(await pending,'short-lived');assert.equal(f.data.get('drive_backend_session'),'b'.repeat(43));assert.equal(f.listeners.size,0);
});
test('pending backup state survives reload and resumes only with a connection',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const snippet=html.slice(html.indexOf('let backupRevision ='),html.indexOf('let lastBackupTime ='));
 let scheduled=0;const ctx=vm.createContext({localStorage:{getItem:k=>k==='backup_revision'?'10':'9'},navigator:{onLine:true},dbxToken:null,gdriveToken:'session',gdriveNeedsReconnect:false,scheduleAutoBackup(){scheduled++}});
 vm.runInContext(snippet,ctx);assert(ctx.backupIsPending());ctx.resumePendingBackup();assert.equal(scheduled,1);ctx.navigator.onLine=false;ctx.resumePendingBackup();assert.equal(scheduled,1);
 for(const [,script]of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script);
});
