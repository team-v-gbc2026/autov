// Run from frontend: node scripts/engine-export/prepare-presentation.mjs <destination> <Unity-template>
// Uses only Packages and ProjectSettings from an existing Built-in, legacy-input project.
import { cp, mkdir, readdir, writeFile, chmod, access } from 'node:fs/promises';
import path from 'node:path';
const [destination,template]=process.argv.slice(2);
if(!destination||!template) throw Error('Expected destination and Unity template project');
const root=path.resolve(destination), project=path.join(root,'Unity');
const source=path.resolve('.autov-local/engine-export');
const cases=['fire-projectile','shield'];
for(const id of cases) await access(path.join(source,id,'effect.avfx.json'));
await mkdir(root,{recursive:true});
for(const folder of ['Packages','ProjectSettings']) if(path.resolve(template)!==project)
  await cp(path.join(template,folder),path.join(project,folder),{recursive:true});
for(const id of cases) {
  const bundle=path.join(root,'Bundles',id);
  await cp(path.join(source,id),bundle,{recursive:true,filter:p=>!['.godot','effect.zip'].includes(path.basename(p))&&!p.endsWith('.import')});
  await cp('../adapters/godot/demo.gd',path.join(bundle,'Godot/demo.gd'));
  await cp(bundle,path.join(project,'Assets/Bundles',id),{recursive:true,filter:p=>!['Unity','Godot','.godot','effect.zip'].includes(path.basename(p))&&!p.endsWith('.import')});
  await cp('scripts/engine-export/capture-godot.gd',path.join(bundle,'Godot/capture.gd'));
  const file=path.join(root,`Godot - ${id}.command`);
  await writeFile(file,`#!/bin/zsh\nset -e\ncd -- "$(dirname -- "$0")"\nengine="\${GODOT_BIN:-/Applications/Godot.app/Contents/MacOS/Godot}"\n[[ -x "$engine" ]] || engine="$HOME/Downloads/Godot.app/Contents/MacOS/Godot"\nexec "$engine" --path "$PWD/Bundles/${id}/Godot" -- --presentation\n`);
  await chmod(file,0o755);
}
await cp('../adapters/unity',path.join(project,'Assets/AutoVAdapters'),{recursive:true});
for(const file of await readdir('public/engine-export/Unity')) if(file.endsWith('.shader'))
  await cp(path.join('public/engine-export/Unity',file),path.join(project,'Assets/AutoVAdapters',file));
await mkdir(path.join(project,'Assets/Editor'),{recursive:true});
for(const file of await readdir('scripts/engine-export/unity')) if(file.endsWith('.cs'))
  await cp(path.join('scripts/engine-export/unity',file),path.join(project,file==='AvfxPresentationControls.cs'?'Assets':'Assets/Editor',file));
const launcher=path.join(root,'Unity - Presentation.command');
await writeFile(launcher,'#!/bin/zsh\nset -e\ncd -- "$(dirname -- "$0")"\nopen "$PWD/AutoV Unity.app"\n');
await chmod(launcher,0o755);
await writeFile(path.join(root,'README.txt'),`autoV · Fire Projectile / Shield\n\nUnity: Unity - Presentation.command (built application)\nGodot: Godot - fire-projectile.command / Godot - shield.command\n\nUnity: 1 = Fire Projectile, 2 = Shield, arrows = orbit, 0 = reset, Space = pause. Godot: drag = orbit, scroll = zoom, Space = pause.\nKeep this folder together.\n\nBuild with Unity Editor -batchmode -projectPath "${project}" -executeMethod AvfxValidation.RunPresentation -quit, then -executeMethod AvfxPresentation.Build.\n`);
console.log(root);
