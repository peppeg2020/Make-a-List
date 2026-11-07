import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {Firestore} from '@google-cloud/firestore';
import {OAuth2Client} from 'google-auth-library';
import {createService} from './core.mjs';
const env=process.env;
for(const name of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','TOKEN_KEY','PUBLIC_URL','APP_ORIGIN','ALLOWED_EMAIL']) if(!env[name]) throw Error('Missing '+name);
const publicUrl=env.PUBLIC_URL.replace(/\/$/,'');
if(!env.APP_ORIGIN.startsWith('https://') || !publicUrl.startsWith('https://') || new URL(env.APP_ORIGIN).origin!==env.APP_ORIGIN) throw Error('Invalid deployment origins');
const db=new Firestore({databaseId:env.FIRESTORE_DATABASE || '(default)'});
const ref=(collection,id)=>db.collection('drive_'+collection).doc(id);
const store={
 async create(c,id,data){await ref(c,id).create({...data,expireAt:new Date(data.expires)});},
 async get(c,id){return (await ref(c,id).get()).data();},
 async update(c,id,data){await ref(c,id).update({...data,expireAt:new Date(data.expires)});},
 async consume(c,id){return db.runTransaction(async tx=>{const r=ref(c,id),s=await tx.get(r);if(s.exists)tx.delete(r);return s.data();});}
};
const service=createService({store,key:env.TOKEN_KEY,origin:env.APP_ORIGIN,publicUrl,allowedEmail:env.ALLOWED_EMAIL,clientId:env.GOOGLE_CLIENT_ID,oauthFactory:()=>new OAuth2Client({clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,redirectUri:publicUrl+'/oauth/callback'})});
const rates=new Map();
createServer(async(req,res)=>{
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
 const url=new URL(req.url,'https://backend.invalid');
 try{
  if(url.pathname==='/health' && req.method==='GET')return send(200,{ok:true});
  if(url.pathname==='/oauth/callback' && req.method==='GET'){
   const state=url.searchParams.get('state');
   const secret=await service.callback(state,url.searchParams.get('code'));
   const nonce=randomBytes(16).toString('base64');
   res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'`);
   const message=JSON.stringify({type:'make-a-list-drive-connected',state,secret}).replaceAll('<','\\u003c');
   const target=JSON.stringify(env.APP_ORIGIN).replaceAll('<','\\u003c');
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
   return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>Google Drive connected</title><p>Google Drive connected. Return to Make a List. If it has not connected, close this window and try connecting again from the app.</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage(${message},${target});window.close();}</script>`);
  }
  if(req.headers.origin!==env.APP_ORIGIN)return send(403,{error:'origin_not_allowed'});
  res.setHeader('Access-Control-Allow-Origin',env.APP_ORIGIN);res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){
   res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');return send(204,null);
  }
  if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
  if(url.pathname==='/connect'){
   // Bound unauthenticated connection attempts per instance; session access still
   // requires a random 256-bit device secret and verified owner Google identity.
   const minute=Math.floor(Date.now()/60000);for(const k of rates.keys())if(k!==minute)rates.delete(k);
   rates.set(minute,(rates.get(minute)||0)+1);if(rates.get(minute)>20)return send(429,{error:'try_later'});
   let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)return send(413,{error:'too_large'});}
   return send(200,await service.connect());
  }
  const secret=req.headers.authorization?.replace(/^Bearer /,'');
  if(url.pathname==='/token'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)return send(413,{error:'too_large'});}
   return send(200,await service.token(secret,JSON.parse(body || '{}').force===true));
  }
  if(url.pathname==='/disconnect'){await service.disconnect(secret);return send(200,{ok:true});}
  return send(404,{error:'not_found'});
 }catch(e){
  // Never log OAuth responses, bearer credentials, URLs with codes, or secrets.
  send(e.status || 503,{error:e.status ? e.code : 'temporarily_unavailable'});
 }
}).listen(Number(env.PORT || 8080),'0.0.0.0');
