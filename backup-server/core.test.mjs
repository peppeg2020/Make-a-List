import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createService,hash} from './core.mjs';
function setup({email="owner@example.com",scope="https://www.googleapis.com/auth/drive.file"}={}){
 const records=new Map();let options,invalid=false,renewals=0;
 const store={async create(c,id,d){if(records.has(c+id))throw Error('exists');records.set(c+id,d);},async get(c,id){return records.get(c+id)},async update(c,id,d){if(!records.has(c+id))throw Error('missing');records.set(c+id,d)},async consume(c,id){const d=records.get(c+id);records.delete(c+id);return d}};
 const service=createService({store,key:randomBytes(32).toString('base64'),origin:'https://app.example',publicUrl:'https://server.example',allowedEmail:'owner@example.com',clientId:'client',oauthFactory:()=>({
 generateAuthUrl(o){options=o;return 'https://accounts.google.com/auth';},
 async getToken(){return {tokens:{refresh_token:'private-refresh',access_token:'old',expiry_date:1,id_token:'id',scope}}},
 async verifyIdToken(o){assert.equal(o.audience,'client');return {getPayload:()=>({email,email_verified:true,nonce:options.nonce})}},
 setCredentials(t){this.credentials=t},async getAccessToken(){renewals++;if(invalid)throw {response:{data:{error:'invalid_grant'}}};this.credentials.access_token='new';this.credentials.expiry_date=Date.now()+3600000;return {token:'new'}}
 })});
 return {service,records,get options(){return options},get renewals(){return renewals},invalidate(){invalid=true}};
}
test('single-use state, PKCE, offline access, encrypted storage, renewal and disconnect',async()=>{
 const f=setup(),{state}=await f.service.connect();assert.equal(f.options.access_type,'offline');assert.equal(f.options.code_challenge_method,'S256');
 const secret=await f.service.callback(state,'code');assert(!JSON.stringify([...f.records]).includes('private-refresh'));
 await assert.rejects(f.service.callback(state,'code'),/expired_connection/);
 await assert.rejects(f.service.token(randomBytes(32).toString('base64url')),/reconnect/);
 const [a,b]=await Promise.all([f.service.token(secret),f.service.token(secret)]);assert.equal(a.access_token,'new');assert.equal(b.access_token,'new');assert.equal(f.renewals,1);
 await f.service.disconnect(secret);await assert.rejects(f.service.token(secret),/reconnect/);
});
test('revoked grant requires reconnect and removes session',async()=>{
 const f=setup(),{state}=await f.service.connect(),secret=await f.service.callback(state,'code');f.invalidate();await assert.rejects(f.service.token(secret),/reconnect/);assert(!f.records.has('sessions'+hash(secret)));
});
test('expired authorization and cancellation cannot create a session',async()=>{
 const f=setup(),{state}=await f.service.connect();for(const v of f.records.values())v.expires=0;
 await assert.rejects(f.service.callback(state,'code'),/expired_connection/);
 const next=await f.service.connect();await assert.rejects(f.service.callback(next.state,''),/connection_cancelled/);
 assert.equal(f.records.size,0);
});

test('wrong owner and missing Drive permission cannot create sessions',async()=>{
 for(const config of [{email:'other@example.com'},{scope:'openid email'}]){
  const f=setup(config),{state}=await f.service.connect();
  await assert.rejects(f.service.callback(state,'code'),/account_not_allowed|drive_permission_required/);
  assert.equal(f.records.size,0);
 }
});
