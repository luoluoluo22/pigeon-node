// Pigeon Node v0.1: Windows/Linux independent identity and WSS transport.
// The node has no shell/file-execution listener. Only signed device-to-device text probes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const endpoint = process.env.PIGEON_ENDPOINT || 'https://pigeon-dev.a1137583371.workers.dev';
const home = process.env.PIGEON_NODE_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'.local','share'), 'Pigeon', 'node');
const profileFile = path.join(home,'profile.json');
const stateFile = path.join(home,'connection-state.json');
const state = (s, extra={}) => {try{fs.mkdirSync(home,{recursive:true});fs.writeFileSync(stateFile+'.tmp',JSON.stringify({at:now(),state:s,pid:process.pid,...extra}));fs.renameSync(stateFile+'.tmp',stateFile)}catch(e){console.error(JSON.stringify({event:'state_write_error',error:e.message}))}};
const maxLog = 3 * 1024 * 1024;
const args = process.argv.slice(2);
const op = args[0] || 'status';
const opt = (k,def=null) => {const p=args.indexOf(k);return p>=0?args[p+1]:def;};
const now = () => new Date().toISOString();
const say = (event, extra={}) => {const data={at:now(),event,...extra};console.log(JSON.stringify(data));try{fs.mkdirSync(home,{recursive:true});const f=path.join(home,'node-events.jsonl');if(fs.existsSync(f)&&fs.statSync(f).size>maxLog)fs.renameSync(f,f+'.old');fs.appendFileSync(f,JSON.stringify(data)+'\n');}catch{}};
const readProfile = () => {if(!fs.existsSync(profileFile))throw Error('Missing local profile: run init first');return JSON.parse(fs.readFileSync(profileFile,'utf8'));};
const saveProfile = p => {fs.mkdirSync(home,{recursive:true});fs.writeFileSync(profileFile,JSON.stringify(p,null,2),{mode:0o600,flag:'w'});try{fs.chmodSync(profileFile,0o600)}catch{}};
const encode64 = bytes => Buffer.from(bytes).toString('base64url');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fetchAdmin = async (url,body) => {
  const tokenFile=process.env.PIGEON_ADMIN_TOKEN_FILE || path.join(process.env.LOCALAPPDATA||'', 'Pigeon','dev','pilot-token.txt');
  const token=fs.readFileSync(tokenFile,'utf8').trim();
  const r=await fetch(new URL(url,endpoint),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json();if(!r.ok)throw Error('Admin API '+r.status+': '+JSON.stringify(j));return j;
};
async function main(){
if(op==='init'){
  const name=opt('--name',os.hostname());
  if(fs.existsSync(profileFile)){const p=readProfile();say('already_initialized',{display_name:p.display_name,registered:!!p.device_id,public_key_jwk:p.public_key_jwk});return;}
  if(!name || name.length>64)throw Error('Invalid name');
  const pair=await crypto.webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const pkcs8=Buffer.from(await crypto.webcrypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64');
  const jwk=await crypto.webcrypto.subtle.exportKey('jwk',pair.publicKey);
  const pub={kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y};
  saveProfile({schema:1,display_name:name,device_id:null,public_key_jwk:pub,private_key_pkcs8:pkcs8});
  say('initialized',{display_name:name,public_key_jwk:pub,registered:false});return;
}
if(op==='status'){if(!fs.existsSync(profileFile)){say('not_initialized');return;}const p=readProfile();say('status',{display_name:p.display_name,device_id:p.device_id,has_private_key:!!p.private_key_pkcs8,public_key_jwk:p.public_key_jwk});return;}
if(op==='attach'){
  const id=opt('--id');
  if(!uuid.test(id||''))throw Error('Invalid device ID');
  const p=readProfile();
  if(p.device_id&&p.device_id!==id)throw Error('Profile already attached to another device; refuse overwrite');
  p.device_id=id;saveProfile(p);say('attached',{device_id:id});return;
}
if(op==='enroll'){
  const p=readProfile();
  const inviteFile=opt('--invite-file');
  let code=inviteFile?fs.readFileSync(inviteFile,'utf8').trim():null;
  if(!code && !args.includes('--pilot-admin') && process.stdin.isTTY){
    const readline=await import('node:readline/promises');
    const io=readline.createInterface({input:process.stdin,output:process.stdout});
    try{code=(await io.question('Paste the one-time binding code from Pigeon Admin: ')).trim();}finally{io.close()}
  }
  if(code){
    if(p.device_id)throw Error('Already registered. Use status; do not consume another invite.');
    if(!/^[a-f0-9]{64}$/.test(code))throw Error('Invalid one-time binding code');
    const privateKey=await crypto.webcrypto.subtle.importKey('pkcs8',Buffer.from(p.private_key_pkcs8,'base64'),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
    const signedData=['PIGEON-ENROLL',code,p.display_name].join(String.fromCharCode(10));
    const signature=encode64(await crypto.webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,new TextEncoder().encode(signedData)));
    const response=await fetch(new URL('/v1/enrollment/claim',endpoint),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invite_code:code,display_name:p.display_name,public_key_jwk:p.public_key_jwk,signature})});
    const data=await response.json();
    if(!response.ok)throw Error('Enrollment failed: '+response.status+' '+(data.error||'unknown'));
    p.device_id=data.device_id;saveProfile(p);say('enrolled',{device_id:p.device_id,invite:true});return;
  }
  if(!args.includes('--pilot-admin'))throw Error('Provide --invite-file with a code, or use an interactive terminal.');
  // Pilot-only compatibility path: requires an existing administrator secret.
  const r=await fetchAdmin('/v1/nodes/enroll',{display_name:p.display_name,public_key_jwk:p.public_key_jwk});
  if(p.device_id&&p.device_id!==r.device_id)throw Error('Server assigned a different identity');
  p.device_id=r.device_id;saveProfile(p);say('enrolled',{device_id:p.device_id,reused:r.reused});return;
}
if(op==='admin-enroll'){
  const name=opt('--name');
  const jwkData=opt('--jwk-base64');
  if(!name||!jwkData)throw Error('Need --name and --jwk-base64 (PUBLIC key only)');
  const jwk=JSON.parse(Buffer.from(jwkData,'base64url').toString('utf8'));
  const r=await fetchAdmin('/v1/nodes/enroll',{display_name:name,public_key_jwk:jwk});
  say('admin_enrolled',{device_id:r.device_id,display_name:name,reused:r.reused});return;
}
if(op==='run'){
  const p=readProfile();
  if(!uuid.test(p.device_id||''))throw Error('Not enrolled. Run attach or enroll first');
  const peer=opt('--peer');
  const count=Math.max(0,Math.min(30,Number(opt('--count','0'))));
  if(peer&&!uuid.test(peer))throw Error('Invalid peer ID');
  let stops=false,attempt=0,connection=null;
  const sent=new Map();
  const privateKey=await crypto.webcrypto.subtle.importKey('pkcs8',Buffer.from(p.private_key_pkcs8,'base64'),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  process.on('SIGINT',()=>{stops=true;connection?.close();process.exit(0)});
  process.on('SIGTERM',()=>{stops=true;connection?.close();process.exit(0)});
  async function connect(){
    if(stops)return;
    const ts=String(Date.now());
    const nonce=encode64(crypto.randomBytes(24));
    const signData=[p.device_id,ts,nonce,'GET','/v1/nodes/connect'].join('\n');
    const signature=encode64(await crypto.webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,new TextEncoder().encode(signData)));
    const url=new URL('/v1/nodes/connect',endpoint);
    url.searchParams.set('device_id',p.device_id);
    url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const ws=new WebSocket(url,{headers:{'X-Pigeon-Timestamp':ts,'X-Pigeon-Nonce':nonce,'X-Pigeon-Signature':signature},handshakeTimeout:14000});
    connection=ws;let pingTimer;let opened=false;let waitingForPong=false;let sentPingAt=0;
    state('connecting',{device_id:p.device_id});
    ws.on('open',()=>{opened=true;attempt=0;state('connected',{device_id:p.device_id});say('socket_open',{device_id:p.device_id,peer:peer||null});pingTimer=setInterval(()=>{
      if(ws.readyState!==WebSocket.OPEN)return;
      if(waitingForPong){if(Date.now()-sentPingAt>90000){say('heartbeat_timeout',{elapsed_ms:Date.now()-sentPingAt});state('heartbeat_timeout',{device_id:p.device_id});ws.terminate();}return;}
      sentPingAt=Date.now();waitingForPong=true;ws.ping();
    },45000);});
    ws.on('pong',()=>{waitingForPong=false;state('connected',{device_id:p.device_id,last_pong_at:now()});});
    ws.on('message',data=>{
      let msg;try{msg=JSON.parse(String(data))}catch{return;}
      if(msg.type==='ready'){
        say('ready',{device_id:p.device_id,online:msg.online});
        if(peer&&count)for(let i=0;i<count;i++)setTimeout(()=>{
          if(ws.readyState!==WebSocket.OPEN)return;
          const trace=crypto.randomUUID();
          sent.set(trace,Date.now());
          ws.send(JSON.stringify({type:'message',target_id:peer,trace_id:trace,text:'probe:'+i}));
          say('probe_sent',{to:peer,trace_id:trace,index:i});
        },1200+i*1200);
      }
      else if(msg.type==='message'){
        say('message_received',{from:msg.from,trace_id:msg.trace_id,kind:String(msg.text||'').startsWith('probe:')?'probe':'response'});
        if(String(msg.text||'').startsWith('probe:') && uuid.test(msg.from||'')){
          ws.send(JSON.stringify({type:'message',target_id:msg.from,trace_id:msg.trace_id,text:'reply:'+String(msg.text).slice(6)}));
        } else if(String(msg.text||'').startsWith('reply:') && sent.has(msg.trace_id)){
          say('round_trip',{peer:msg.from,trace_id:msg.trace_id,rtt_ms:Date.now()-sent.get(msg.trace_id)});sent.delete(msg.trace_id);
        }
      }
      else if(msg.type==='error')say('message_error',{reason:msg.error,trace_id:msg.trace_id||null});
      else if(msg.type==='delivered')say('delivery_ack',{to:msg.target_id,trace_id:msg.trace_id});
    });
    ws.on('unexpected-response',(_req,response)=>{say('rejected',{http:response.statusCode});state('rejected',{device_id:p.device_id,http:response.statusCode});if(response.statusCode===401||response.statusCode===403){stops=true;process.exitCode=13;setTimeout(()=>process.exit(13),1000);}});
    ws.on('error',err=>say('network_error',{error:err.code||err.message}));
    ws.on('close',(code)=>{if(pingTimer)clearInterval(pingTimer);say('socket_closed',{code,opened});if(code===4001){stops=true;state('revoked',{device_id:p.device_id});process.exitCode=13;return;}if(!stops){const ms=Math.min(15000,600*2**Math.min(5,attempt++))+Math.floor(Math.random()*200);state('reconnecting',{device_id:p.device_id,retry_in_ms:ms,close_code:code});setTimeout(connect,ms);}});
  }
  await connect();return;
}
throw Error('Unsupported operation: '+op);
}
main().catch(err=>{console.error(JSON.stringify({event:'fatal',error:err.message}));process.exitCode=1});
