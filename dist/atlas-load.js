import {assets} from './atlas-assets.js?v=1';
export {assets};
export async function loadPoints(url) {
  const response=await fetch(url);
  if(!response.ok)throw Error('星图数据暂未加载，请重试');
  const buffer=await response.arrayBuffer();
  if(buffer.byteLength%6)throw Error('星图数据不完整，请刷新重试');
  const packed=new Int16Array(buffer),points=new Float32Array(packed.length);
  for(let i=0;i<packed.length;i++)points[i]=packed[i]/assets.pointScale;
  return points;
}
