import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const DAY = 86400000;
export function createService({store,oauthFactory,key,origin,publicUrl,allowedEmail,clientId,now=Date.now}) {
  if (Buffer.from(key,'base64').length !== 32) throw Error('TOKEN_KEY must be 32 bytes in base64');
  const seal = value => {
    const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'base64'),iv);
    const body=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');
  };
  const unseal = value => {
    const b=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'base64'),b.subarray(0,12));
    cipher.setAuthTag(b.subarray(12,28));
    return JSON.parse(Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString());
  };
  const error = (status,code) => Object.assign(Error(code),{status,code});
  const validSecret = secret => /^[A-Za-z0-9_-]{43}$/.test(secret || '');
  const locks=new Map();
  return {
    origin,
    async connect() {
      const state=random(), verifier=random(), nonce=random();
      // Single-use OAuth state, PKCE and nonce bind the authorization response.
      await store.create('pending',hash(state),{verifier:seal(verifier),nonce,expires:now()+10*60000});
      const client=oauthFactory();
      const url=client.generateAuthUrl({access_type:'offline',prompt:'consent',scope:['openid','email','https://www.googleapis.com/auth/drive.file'],state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
      return {url,state};
    },
    async callback(state,code) {
      const pending=await store.consume('pending',hash(state || ''));
      if (!pending || pending.expires < now()) throw error(400,'expired_connection');
      if (!code) throw error(400,'connection_cancelled');
      const client=oauthFactory();
      const {tokens}=await client.getToken({code,codeVerifier:unseal(pending.verifier),redirect_uri:publicUrl+'/oauth/callback'});
      const ticket=await client.verifyIdToken({idToken:tokens.id_token,audience:clientId});
      const identity=ticket.getPayload();
      if (!identity.email_verified || identity.email?.toLowerCase() !== allowedEmail.toLowerCase() || identity.nonce !== pending.nonce) throw error(403,'account_not_allowed');
      if (!tokens.refresh_token || !tokens.scope?.split(' ').includes('https://www.googleapis.com/auth/drive.file')) throw error(400,'drive_permission_required');
      const secret=random();
      await store.create('sessions',hash(secret),{encrypted:seal(tokens),expires:now()+180*DAY});
      return secret;
    },
    async token(secret, force = false) {
      if (!validSecret(secret)) throw error(401,'reconnect');
      const id=hash(secret);
      if (locks.has(id)) return locks.get(id);
      const work=(async()=>{
        const session=await store.get('sessions',id);
        if (!session || session.expires < now()) throw error(401,'reconnect');
        const client=oauthFactory();client.setCredentials(unseal(session.encrypted));
        if (force) client.credentials.expiry_date = 1;
        try {
          const access=await client.getAccessToken();
          if (!access.token) throw error(401,'reconnect');
          // update never recreates a session deleted while renewal was in flight.
          await store.update('sessions',id,{encrypted:seal(client.credentials),expires:now()+180*DAY});
          return {access_token:access.token,expires_at:client.credentials.expiry_date};
        } catch(e) {
          if (e.response?.data?.error==='invalid_grant' || e.code==='reconnect') {
            await store.consume('sessions',id);throw error(401,'reconnect');
          }
          throw error(503,'temporarily_unavailable');
        }
      })().finally(()=>locks.delete(id));
      locks.set(id,work);return work;
    },
    async disconnect(secret) {
      if (!validSecret(secret)) throw error(401,'reconnect');
      // Remove only this device's session, not Google's project-wide grant.
      await store.consume('sessions',hash(secret));
    }
  };
}
