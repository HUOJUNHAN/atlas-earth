import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),site=path.join(root,'site');
for(const page of ['index.html','globe/index.html','galaxy/index.html']){
 const html=fs.readFileSync(path.join(site,page),'utf8');
 const documentURL=new URL(page,'https://example.invalid/atlas-earth/');
 const base=html.match(/<base href="([^"]+)"/)?.[1];const baseURL=base?new URL(base,documentURL):documentURL;
 for(const match of html.replace(/<base\b[^>]*>/gi,'').matchAll(/(?:src|href)="([^"]+)"/g)){
  if(match[1].startsWith('data:')||match[1].startsWith('#'))continue;
  const resolved=new URL(match[1],baseURL);
  if(resolved.origin!=='https://example.invalid')continue;
  assert.ok(resolved.pathname.startsWith('/atlas-earth/'),'Escaped project subpath: '+resolved.href);
  let local=path.join(site,decodeURIComponent(resolved.pathname.slice('/atlas-earth/'.length)));
  if(fs.existsSync(local)&&fs.statSync(local).isDirectory())local=path.join(local,'index.html');
  assert.ok(fs.existsSync(local),page+': missing '+resolved.pathname);
 }
}
const places=JSON.parse(fs.readFileSync(path.join(site,'assets/cities.json'),'utf8'));
assert.equal(places.length,558);assert.ok(places.every(place=>place.description?.trim()));
assert.ok(fs.existsSync(path.join(site,'.nojekyll')));assert.ok(!fs.existsSync(path.join(site,'.openai')));
console.log('Checked all three Pages entry points, local assets and 558 place introductions.');
