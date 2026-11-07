// Filled only after the Cloud Run service and Google callback are verified.
window.MAKE_A_LIST_DRIVE_BACKEND = 'https://make-a-list-drive-c3qpahrqca-uc.a.run.app';
class DriveConnection {
  constructor(base, storage = localStorage) {
    this.base=base.replace(/\/$/,'');this.storage=storage;this.cached=null;this.pending=null;
    this.secret=storage.getItem('drive_backend_session');
  }
  get enabled(){return !!this.base;}
  get connected(){return this.enabled && !!this.secret;}
  async request(path,secret=this.secret,body={}){
    const response=await fetch(this.base+path,{method:'POST',headers:{'Content-Type':'application/json',...(secret?{Authorization:'Bearer '+secret}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const data=await response.json();
    if(!response.ok)throw new Error(response.status===401?'Google Drive session expired. Please reconnect.':'Google Drive connection temporarily unavailable. Try again.');
    return data;
  }
  async token(force=false){
    if(!force && this.cached?.expires_at>Date.now()+300000)return this.cached.access_token;
    if(this.pending)return this.pending;
    this.pending=this.request('/token',this.secret,{force}).then(data=>{this.cached=data;return data.access_token;}).finally(()=>{this.pending=null;});
    return this.pending;
  }
  connect(){
    // Keep the installed app in place; sign-in runs in a separate window.
    const popup=window.open('about:blank','make_a_list_google');
    if(!popup)return Promise.reject(new Error('Allow the Google sign-in window and try again.'));
    let expectedState;
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);};
      const receive=async event=>{
        if(event.origin!==new URL(this.base).origin || event.source!==popup || event.data?.type!=='make-a-list-drive-connected' || !expectedState || event.data.state!==expectedState)return;
        if(!/^[A-Za-z0-9_-]{43}$/.test(event.data.secret || ''))return;
        cleanup();
        try {
          // Save the device session only after a verified callback; Google's
          // long-lived refresh token never leaves the server.
          this.storage.setItem('drive_backend_session',event.data.secret);
          this.secret=event.data.secret;this.cached=null;
          resolve(await this.token());
        }catch(e){reject(e);}
      };
      const timer=setTimeout(()=>{cleanup();popup.close();reject(new Error('Google sign-in timed out. Please try again.'));},300000);
      window.addEventListener('message',receive);
      this.request('/connect',null).then(data=>{
        const destination=new URL(data.url);
        if(destination.origin!=='https://accounts.google.com')throw Error('Invalid sign-in address');
        expectedState=data.state;popup.location.href=data.url;
      }).catch(e=>{cleanup();popup.close();reject(e);});
    });
  }
  async disconnect(){
    // Keep the local session if the server cannot confirm removal, so retry is possible.
    if(this.connected)await this.request('/disconnect');
    this.storage.removeItem('drive_backend_session');this.secret=null;this.cached=null;
  }
}
window.driveConnection=new DriveConnection(window.MAKE_A_LIST_DRIVE_BACKEND);
