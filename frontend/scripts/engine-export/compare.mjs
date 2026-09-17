// Compare fixed-time views. These metrics describe a fixture, not general parity.
// Usage: node scripts/engine-export/compare.mjs <bundle> <engine-captures> <godot|unity>
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const [bundle, captures, engine] = process.argv.slice(2);
if (!bundle || !captures || !['godot','unity'].includes(engine)) throw new Error('Expected bundle, capture directory and godot|unity');
const rows=[];
for(const angle of [0,90,180]) {
  const reference=join(bundle,`reference/view-${angle}.png`);
  const candidate=join(captures,`${engine}-view-${angle}.png`);
  const a=await sharp(reference).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const b=await sharp(candidate).removeAlpha().raw().toBuffer({resolveWithObject:true});
  if(a.info.width!==b.info.width||a.info.height!==b.info.height) throw new Error('Capture dimensions differ');
  let error=0,foreground=0,count=0;
  const difference=Buffer.alloc(a.data.length);
  for(let i=0;i<a.data.length;i+=3) {
    // The union also catches unexpected bright pixels outside the source effect.
    const included=Math.max(...a.data.subarray(i,i+3),...b.data.subarray(i,i+3))>35;
    for(let c=0;c<3;c++) {
      const d=Math.abs(a.data[i+c]-b.data[i+c]); error+=d;
      if(included) {foreground+=d;count++;}
      difference[i+c]=Math.min(255,d*4);
    }
  }
  rows.push({angle,width:a.info.width,height:a.info.height,wholeImageMAE:error/a.data.length,foregroundUnionMAE:count?foreground/count:0,foregroundPixels:count/3});
  await sharp(difference,{raw:a.info}).png().toFile(join(captures,`${engine}-difference-${angle}.png`));
}
const report={engine,reference:resolve(bundle),candidate:resolve(captures),units:'absolute RGB byte error (0–255)',foreground:'union of pixels with max(R,G,B)>35',differencePreview:'absolute difference ×4, clamped',views:rows};
await writeFile(join(captures,`${engine}-comparison.json`),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
