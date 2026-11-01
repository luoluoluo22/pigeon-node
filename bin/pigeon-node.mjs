#!/usr/bin/env node
// Pigeon Node CLI. The remote MCP server remains in Cloudflare; this CLI runs only
// the local device connector. No shell execution or file-transfer tools exposed.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const agent=path.resolve(here,'../runtime/node-agent.mjs');
const nodeHome=process.env.PIGEON_NODE_HOME||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.local','share'),'Pigeon','node');
const profilePath=path.join(nodeHome,'profile.json');
const args=process.argv.slice(2);
const op=args[0]||'help';
const help=`Pigeon Node — connect your computer to Pigeon

Usage:
  pigeon-node connect [--name NAME]  Bind on first run, then keep the connection open
  pigeon-node setup [--name NAME]    Initialize device and enter a one-time binding code
  pigeon-node run                  Connect to Cloudflare and keep running in foreground
  pigeon-node status               Show local device registration
  pigeon-node doctor               Check runtime and local registration
  pigeon-node init [--name NAME]   Create a local device identity
  pigeon-node enroll               Bind using a one-time code from the Pigeon website
  pigeon-node help                 Show this help

Device website: https://pigeon-dev.a1137583371.workers.dev/admin/
Requires Node.js 22+. Signing keys remain on the current machine.
For persistent Linux servers, globally install a pinned version and run
'pigeon-node run' under your own systemd service. NPX alone is foreground-only.
Preview: only small text messages are supported; no file transfer or remote shell.
`;
function readProfile(){
 try {return JSON.parse(fs.readFileSync(profilePath,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw Error('Local profile is unreadable or invalid');}
}
function spawnAgent(childArgs){
 return new Promise((resolve,reject)=>{
  const p=spawn(process.execPath,[agent,...childArgs],{stdio:'inherit',env:process.env,windowsHide:false});
  for(const sig of ['SIGINT','SIGTERM']){
   const handler=()=>{if(p.exitCode===null&&!p.killed)p.kill(sig);};
   process.once(sig,handler);
   p.once('close',()=>process.removeListener(sig,handler));
  }
  p.once('error',reject);
  p.once('exit',(code,signal)=>resolve(code??(signal?128:1)));
 });
}
async function main(){
 if(['help','--help','-h'].includes(op)){process.stdout.write(help);return 0;}
 if(op==='doctor'){
   const profile=readProfile();
   process.stdout.write(JSON.stringify({node:process.version,platform:process.platform,initialized:!!profile,registered:!!profile?.device_id,endpoint:process.env.PIGEON_ENDPOINT||'https://pigeon-dev.a1137583371.workers.dev'})+'\n');
   return 0;
 }
 if(!fs.existsSync(agent))throw Error('Packaged node agent is missing; reinstall Pigeon Node');
 if(op==='setup'||op==='connect'){
   const allowed=new Set(['--name']);
   for(let i=1;i<args.length;i+=2){
     if(!allowed.has(args[i])||!args[i+1])throw Error('Usage: pigeon-node '+op+' [--name NAME]');
   }
   const p=readProfile();
   if(!p){const status=await spawnAgent(['init',...args.slice(1)]);if(status!==0)return status;}
   const prepared=readProfile();
   if(prepared?.device_id){process.stdout.write('Pigeon is already registered on this machine.\n');return op==='connect'?spawnAgent(['run']):0;}
   process.stdout.write('Open https://pigeon-dev.a1137583371.workers.dev/admin/ and choose Add device.\nPaste the one-time code at the prompt.\n');
   const enrolled=await spawnAgent(['enroll']);
   if(enrolled===0){process.stdout.write('Device registered.\n');return op==='connect'?spawnAgent(['run']):0;}
   return enrolled;
 }
 if(['init','enroll','run','status'].includes(op))return spawnAgent(args);
 throw Error('Unsupported command. Run pigeon-node help');
}
main().then(code=>{process.exitCode=code}).catch(err=>{
 console.error('Pigeon Node: '+err.message);
 process.exitCode=1;
});
