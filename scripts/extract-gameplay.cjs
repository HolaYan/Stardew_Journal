#!/usr/bin/env node
'use strict';
// Read only from the user's installed game. All extracted text and art stay in
// ignored web/game-assets; the source distribution contains no game content.
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), zlib=require('node:zlib');
const xnb=require('./lib/xnb.cjs');
const root=path.resolve(__dirname,'..');
const content=process.argv[2]||path.join(os.homedir(),'Library/Application Support/Steam/steamapps/common/Stardew Valley/Contents/Resources/Content');
const target=path.join(root,'web/game-assets');
const assembly=path.resolve(content,'../../MacOS/StardewValley.GameData.dll');
require('./lib/game-readers.cjs')(xnb,assembly);
const cache=new Map();
function read(asset) {
  asset=asset.replaceAll('\\','/');
  if(cache.has(asset))return cache.get(asset);
  const b=fs.readFileSync(path.join(content,asset+'.xnb'));
  const log=console.log, info=console.info; let decoded;
  try {console.log=console.info=()=>{}; decoded=xnb.bufferToXnb(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)).content;} finally {console.log=log;console.info=info;}
  cache.set(asset,decoded); return decoded;
}
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(type,data) {const t=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);let c=0xffffffff;for(const v of Buffer.concat([t,data]))c=crcTable[(c^v)&255]^(c>>>8);crc.writeUInt32BE((c^0xffffffff)>>>0);return Buffer.concat([length,t,data,crc]);}
function png(data,width,height) {const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;const scan=Buffer.alloc(height*(width*4+1));for(let y=0;y<height;y++)Buffer.from(data).copy(scan,y*(width*4+1)+1,y*width*4,(y+1)*width*4);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);}
function texture(asset,output,crop) {
  const image=read(asset).export;
  if(!image?.data)throw Error('Expected texture '+asset);
  let data=image.data,width=image.width,height=image.height;
  if(crop) {width=crop.width;height=crop.height;const cropped=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)Buffer.from(data).copy(cropped,y*width*4,((crop.y+y)*image.width+crop.x)*4,((crop.y+y)*image.width+crop.x+width)*4);data=cropped;}
  fs.mkdirSync(path.dirname(path.join(target,output)),{recursive:true});
  fs.writeFileSync(path.join(target,output),png(data,width,height));
  return {texture:'game-assets/'+output,textureWidth:width,textureHeight:height};
}
function localize(value) {
  if(!value)return '';
  return value.replace(/\[LocalizedText ([^:\]]+):([^\]]+)\]/g,(_,asset,key)=>read(asset+'.zh-CN')[key]||read(asset)[key]||key);
}
const rawObjects=read('Data/Objects'), rawCrops=read('Data/Crops'), rawRecipes=read('Data/CookingRecipes'), rawCharacters=read('Data/Characters'), rawFish=read('Data/Fish');
const sheets={};
function sheet(asset) {asset=(asset||'Maps/springobjects').replaceAll('\\','/');if(!sheets[asset])sheets[asset]=texture(asset,'img/'+path.basename(asset).toLowerCase()+'.png');return sheets[asset];}
const objects={};
for(const [id,o] of Object.entries(rawObjects))objects[id]={id,name:localize(o.DisplayName)||o.Name,internalName:o.Name,spriteIndex:o.SpriteIndex,category:o.Category,...sheet(o.Texture),columns:sheet(o.Texture).textureWidth/16};
const fish=[];
for(const [id,row] of Object.entries(rawFish)) {
  const object=objects[id],rawObject=rawObjects[id],parts=row.split('/');
  // The legendary families are exceptional game encounters, not ordinary pond
  // catches. Algae and seaweed remain catchable but cannot replace fish in food.
  if(!object||rawObject.ContextTags?.includes('fish_legendary'))continue;
  const crabPot=parts[1]==='trap';
  fish.push({...object,description:localize(rawObject.Description),isFish:object.category===-4,
    catchMethod:crabPot?'crabPot':'rod',
    seasons:crabPot?['spring','summer','fall','winter']:parts[6].trim().split(/\s+/),
    ...(crabPot?{water:parts[4]}:{difficulty:Number(parts[1]),behavior:parts[2]})});
}
const crops=[];const seenCrops=new Set();
for(const [seedId,c] of Object.entries(rawCrops)) {
  const id=c.HarvestItemId,object=objects[id];
  // These wild-seed rows have randomized forage harvests handled specially by
  // game code. Do not present their placeholder harvest IDs as a fixed crop.
  if(['495','496','497','498'].includes(seedId)||!object||seenCrops.has(id)||!Array.isArray(c.DaysInPhase)||c.DaysInPhase.length===0)continue;
  const growthDays=c.DaysInPhase.reduce((a,b)=>a+b,0), regrowDays=c.RegrowDays;
  if(growthDays<=0)continue;
  seenCrops.add(id);
  crops.push({...object,seedId,growthDays,regrowDays,seasons:c.Seasons.map(i=>['spring','summer','fall','winter'][i]),cropSpriteIndex:c.SpriteIndex,growthPhases:c.DaysInPhase,phaseCount:c.DaysInPhase.length,cropTexture:sheet(c.Texture).texture,tier:regrowDays>0||growthDays>=15?90:growthDays<=7?7:30});
}
crops.sort((a,b)=>a.tier-b.tier||a.growthDays-b.growthDays||a.id.localeCompare(b.id));
const recipes=[];
for(const [key,row] of Object.entries(rawRecipes)) {const parts=row.split('/'),outputs=parts[2]?.trim().split(/\s+/),id=outputs?.[0];if(!objects[id])continue;const words=parts[0].trim().split(/\s+/),ingredients=[];for(let i=0;i<words.length;i+=2)ingredients.push({id:words[i],count:Number(words[i+1])});recipes.push({...objects[id],key,ingredients,outputCount:Number(outputs[1]||1)});}
const npcNames=read('Strings/NPCNames.zh-CN'), extra=read('Data/ExtraDialogue.zh-CN');
const aliases={'Mister Qi':'MrQi',Leo:'ParrotBoy',ProfessorSnail:'SafariGuy'};
const villagers=[];
function quotesFrom(entries,source) {
  const quotes=[];
  for(const [key,raw] of entries) {
    if(typeof raw!=='string')continue;
    // No invented speech or substitution. Keep exact prose fragments and only
    // discard game formatting; unresolvable branches/player tokens are omitted.
    if(/\$[qrdpyt][\s\d]|\^|\|/.test(raw))continue;
    const parts=raw.split(/#\$[be]#/);
    for(let i=0;i<parts.length;i++) {const text=parts[i].replace(/\$[hsula]\b|\$\d+/g,'').trim();if(text.length<3||text.length>180||/[@%#$^{}\[\]<>\\]/.test(text)||!/[\u3400-\u9fff]/.test(text))continue;quotes.push({key:parts.length>1?key+':'+i:key,text,raw,source});}
  }
  return quotes;
}
const ids=new Set([...Object.keys(rawCharacters),'ProfessorSnail','Fizz']);
for(const id of ids) {
  const c=rawCharacters[id]||{},portraitName=aliases[id]||c.TextureName||id,portraitAsset='Portraits/'+portraitName;
  if(id==='???')continue;
  const name=localize(c.DisplayName)||npcNames[id]||npcNames[id.replaceAll(' ','')]||id;
  let quotes=[];const dialog='Characters/Dialogue/'+id+'.zh-CN';
  if(fs.existsSync(path.join(content,dialog+'.xnb')))quotes.push(...quotesFrom(Object.entries(read(dialog)),dialog));
  if(id==='Leo')quotes.push(...quotesFrom(Object.entries(read('Characters/Dialogue/LeoMainland.zh-CN')),'Characters/Dialogue/LeoMainland.zh-CN'));
  quotes.push(...quotesFrom(Object.entries(extra).filter(([key])=>key.startsWith(id+'_')||new RegExp('^'+id+'\\d').test(key)),'Data/ExtraDialogue.zh-CN'));
  let portrait=null,portraitKind='portrait';
  const portraitFile='portraits/'+id.replace(/[^A-Za-z0-9_-]/g,'_')+'.png';
  if(fs.existsSync(path.join(content,portraitAsset+'.xnb')))portrait=texture(portraitAsset,portraitFile,{x:0,y:0,width:64,height:64}).texture;
  else if(id==='Old Mariner') {portrait=texture('Characters/Mariner',portraitFile,{x:0,y:0,width:16,height:32}).texture;portraitKind='sprite';}
  villagers.push({id,name,portrait,portraitKind,quotes});
}
// Event scripts carry explicit speaker names, providing original lines for
// non-social villagers (e.g. Marlon, Grandpa, the Governor, and the Bouncer).
const byId=new Map(villagers.map(v=>[v.id,v]));byId.set('MrQi',byId.get('Mister Qi'));byId.set('SafariGuy',byId.get('ProfessorSnail'));byId.set('ParrotBoy',byId.get('Leo'));
for(const folder of ['Data/Events','Data/Festivals'])for(const filename of fs.readdirSync(path.join(content,folder)).filter(f=>f.endsWith('.zh-CN.xnb'))) {
  const asset=folder+'/'+filename.slice(0,-4);
  for(const [key,event] of Object.entries(read(asset))) {
    if(typeof event!=='string')continue;
    if(folder==='Data/Festivals') {const npc=byId.get(key.split('_')[0]);if(npc&&!event.includes('/speak '))npc.quotes.push(...quotesFrom([[key,event]],asset));}
    const re=/(?:^|\/)speak\s+(\S+)\s+"([^"\n]*)"/g;let match;while((match=re.exec(event))) {const npc=byId.get(match[1]);if(npc&&npc.quotes.length<350)npc.quotes.push(...quotesFrom([[key,match[2]]],asset));}
  }
}
const cs=read('Strings/StringsFromCSFiles.zh-CN');
byId.get('Grandpa')?.quotes.push(...quotesFrom(Object.entries(cs).filter(([k])=>/^GrandpaStory\.cs\.120(29|30|31|34|35|40)$/.test(k)),'Strings/StringsFromCSFiles.zh-CN'));
byId.get('Welwick')?.quotes.push(...quotesFrom(Object.entries(cs).filter(([k])=>/^TV\.cs\.(13132|13133|13134|13135|1319[1235789]|13200|13201)$/.test(k)),'Strings/StringsFromCSFiles.zh-CN'));
for(const [id,asset,pattern] of [
  ['Fizz','Strings/1_6_Strings.zh-CN',/^Fizz_(Intro|Sweet)/],
  ['Henchman','Strings/Characters.zh-CN',/^Henchman\d/],
  ['Bouncer','Strings/Locations.zh-CN',/^Club_Bouncer_/],
  ['Old Mariner','Strings/Locations.zh-CN',/^Beach_Mariner_Player(HasItem|BuyItem_Question)$/],
])byId.get(id)?.quotes.push(...quotesFrom(Object.entries(read(asset)).filter(([k])=>pattern.test(k)),asset));
for(const npc of villagers) {const seen=new Set();npc.quotes=npc.quotes.filter(q=>{if(seen.has(q.text))return false;seen.add(q.text);return true;});}
const rawAnimals=read('Data/FarmAnimals'),animals=[];
for(const [id,key] of [['chicken','White Chicken'],['duck','Duck'],['cow','White Cow'],['goat','Goat']]) {
  const animal=rawAnimals[key];
  const productId=animal.ProduceItemIds.find(item=>item.Id==='Default').ItemId;
  if(!objects[productId])throw Error('Missing animal product '+productId);
  animals.push({id,name:localize(animal.DisplayName),productId,
    ...texture(animal.Texture,'img/animal_'+id+'.png'),sx:0,sy:0,
    width:animal.SpriteWidth,height:animal.SpriteHeight,
    daysToProduce:animal.DaysToProduce,house:animal.House});
}
const big=read('Data/BigCraftables'),ui={};
for(const [key,id] of [['chest','130'],['fridge','216']]) {const b=big[id],image=sheet(b.Texture||'TileSheets/Craftables');ui[key]={...image,spriteIndex:b.SpriteIndex,width:16,height:32,columns:image.textureWidth/16};}
ui.barn={...texture('Buildings/Barn','img/barn.png'),sx:0,sy:0,width:112,height:112};
const rod=read('Data/Tools').BambooPole,rodImage=sheet(rod.Texture),rodIndex=rod.MenuSpriteIndex>=0?rod.MenuSpriteIndex:rod.SpriteIndex;
ui.fishingRod={...rodImage,name:localize(rod.DisplayName),sx:rodIndex%(rodImage.textureWidth/16)*16,sy:Math.floor(rodIndex/(rodImage.textureWidth/16))*16,width:16,height:16};
// Exact rectangles from the installed farmhouse and wallpaper/floor sheets.
// Keep the full original sheets so indoor scenes can place/repeat these tiles.
for(const [key,asset,sx,sy,width,height] of [
  ['indoorFloor','Maps/walls_and_floors',0,336,32,32],
  ['indoorWall','Maps/walls_and_floors',0,0,16,48],
  ['stove','Maps/farmhouse_tiles',48,208,16,32],
  ['counter','Maps/farmhouse_tiles',32,208,16,32],
  ['sink','Maps/farmhouse_tiles',64,192,16,48],
  ['indoorFridge','Maps/farmhouse_tiles',80,192,16,48],
  ['kitchenUnit','Maps/farmhouse_tiles',16,192,80,48],
])ui[key]={...sheet(asset),sx,sy,width,height};
const catalog={schemaVersion:1,crops,recipes,fish,animals,objects,villagers,ui,source:{locale:'zh-CN',importedAt:new Date().toISOString(),gameVersion:'installed-game',cropCount:crops.length,recipeCount:recipes.length,fishCount:fish.length,animalCount:animals.length,villagerCount:villagers.length,quotedVillagerCount:villagers.filter(v=>v.quotes.length).length,quotes: villagers.reduce((n,v)=>n+v.quotes.length,0)}};
fs.mkdirSync(target,{recursive:true});
fs.writeFileSync(path.join(target,'game-data.js'),'/* Extracted Stardew Valley content © ConcernedApe. Stardew Journal is unofficial. */\nwindow.GameCatalog = '+JSON.stringify(catalog)+';\n');
fs.writeFileSync(path.join(target,'GAMEPLAY-SOURCE.txt'),JSON.stringify({contentDirectory:content,...catalog.source,unquotedVillagers:villagers.filter(v=>!v.quotes.length).map(v=>v.id)},null,2)+'\n');
console.log(`已读取本机游戏：${crops.length} 种作物、${recipes.length} 道食谱、${fish.length} 种鱼获、${animals.length} 种动物、${villagers.length} 位角色、${catalog.source.quotes} 句中文原文。`);
console.log('目录：'+target);
