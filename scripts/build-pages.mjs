import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'dist'),output=path.resolve(root,'site');
if(path.dirname(output)!==root||path.basename(output)!=='site')throw Error('Unexpected build destination');
if(!fs.existsSync(path.join(source,'index.html')))throw Error('Missing dist/index.html');
fs.rmSync(output,{recursive:true,force:true});
const legacyAssets=new Set(['earth-clouds.png','earth-day.jpg','earth-night.png','moon-texture.png','earth-texture.png','land-mask.png','land-points-dense.json','ocean-points-dense.json','land-points.json','ocean-points.json','dense-city-lights.json','world-countries.geojson']);
fs.cpSync(source,output,{recursive:true,filter:filename=>path.basename(filename)!=='.openai'&&!legacyAssets.has(path.basename(filename))});
for(const name of ['globe','galaxy']){
 const html=fs.readFileSync(path.join(source,name+'.html'),'utf8');
 if(html.includes('<base '))throw Error('Unexpected pre-existing base URL');
 fs.mkdirSync(path.join(output,name),{recursive:true});
 fs.writeFileSync(path.join(output,name,'index.html'),html.replace('<head>','<head>\n  <base href="../">'));
}
fs.writeFileSync(path.join(output,'.nojekyll'),'');
const repository=(process.env.GITHUB_REPOSITORY||'HUOJUNHAN/atlas-earth').split('/').at(-1);
const base=process.argv.includes('--root')||repository.toLowerCase().endsWith('.github.io')?'/':'/'+repository+'/';
fs.writeFileSync(path.join(output,'404.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>星图 · 未找到页面</title><style>body{margin:0;min-height:100vh;display:grid;place-content:center;gap:14px;text-align:center;background:#06111e;color:#dbe9e4;font:16px system-ui}h1{font-size:28px;font-weight:500}a{color:#9de9da}</style><h1>这片星空还没有页面</h1><a href="${base}">返回星图首页</a></html>`);
console.log('Built GitHub Pages site/ with world map, /globe/ and /galaxy/.');
