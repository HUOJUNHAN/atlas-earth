import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),site=path.join(root,'site');
const prefix=process.argv.includes('--root')?'/':'/atlas-earth/';
for(const page of ['index.html','globe/index.html','galaxy/index.html']){
 const html=fs.readFileSync(path.join(site,page),'utf8');
 const documentURL=new URL(page,'https://example.invalid'+prefix);
 const base=html.match(/<base href="([^"]+)"/)?.[1];const baseURL=base?new URL(base,documentURL):documentURL;
 for(const match of html.replace(/<base\b[^>]*>/gi,'').matchAll(/(?:src|href)="([^"]+)"/g)){
  if(match[1].startsWith('data:')||match[1].startsWith('#'))continue;
  const resolved=new URL(match[1],baseURL);
  if(resolved.origin!=='https://example.invalid')continue;
  assert.ok(resolved.pathname.startsWith(prefix),'Escaped project subpath: '+resolved.href);
  let local=path.join(site,decodeURIComponent(resolved.pathname.slice(prefix.length)));
  if(fs.existsSync(local)&&fs.statSync(local).isDirectory())local=path.join(local,'index.html');
  assert.ok(fs.existsSync(local),page+': missing '+resolved.pathname);
 }
}
const places=JSON.parse(fs.readFileSync(path.join(site,'assets/cities.json'),'utf8'));
assert.equal(places.length,558);assert.ok(places.every(place=>place.description?.trim()));
assert.ok(fs.existsSync(path.join(site,'.nojekyll')));assert.ok(!fs.existsSync(path.join(site,'.openai')));
const manifest=JSON.parse(fs.readFileSync(path.join(site,'atlas-assets.js'),'utf8').match(/export const assets=(.*);/)[1]);
for(const [key,value] of Object.entries(manifest))if(typeof value==='string')assert.ok(fs.existsSync(path.join(site,value)),key+' asset missing');
for(const key of ['land','ocean','mapDots'])assert.equal(fs.statSync(path.join(site,manifest[key])).size,manifest[key+'Count']*6);
const countries=JSON.parse(fs.readFileSync(path.join(site,manifest.world),'utf8'));
assert.equal(countries.features.length,242);
console.log('Checked all three Pages entry points, local assets and 558 place introductions.');
