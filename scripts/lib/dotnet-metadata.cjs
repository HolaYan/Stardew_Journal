// Minimal read-only ECMA-335 metadata reader. Describes the installed game's
// public data fields, so no copied game code or hardcoded field layouts are needed.
'use strict';
const fs = require('node:fs');
module.exports = function readMetadata(filename) {
  const b = fs.readFileSync(filename);
  const u16 = p => b.readUInt16LE(p), u32 = p => b.readUInt32LE(p);
  const pe = u32(0x3c), count = u16(pe + 6), opt = pe + 24, is64 = u16(opt) === 0x20b;
  const sectionStart = opt + u16(pe + 20);
  function rva(value) { for (let i = 0; i < count; i++) { const p = sectionStart + 40 * i; const start = u32(p + 12); if (value >= start && value < start + Math.max(u32(p + 8), u32(p + 16))) return value - start + u32(p + 20); } throw Error('Invalid PE address'); }
  const cli = rva(u32(opt + (is64 ? 112 : 96) + 14 * 8));
  const meta = rva(u32(cli + 8));
  let p = meta + 16 + u32(meta + 12); p = (p + 3) & ~3;
  const streams = {}; const n = u16(p + 2); p += 4;
  for (let i = 0; i < n; i++) { const offset = u32(p), length = u32(p + 4); p += 8; const end = b.indexOf(0, p); const name = b.toString('utf8', p, end); p = (end + 4) & ~3; streams[name] = {start:meta + offset,length}; }
  const strings = streams['#Strings'].start, blobs = streams['#Blob'].start;
  const str = offset => b.toString('utf8', strings + offset, b.indexOf(0, strings + offset));
  p = (streams['#~'] || streams['#-']).start;
  const heap = b[p + 6], sizes = {s:heap & 1 ? 4 : 2, g:heap & 2 ? 4 : 2, b:heap & 4 ? 4 : 2};
  const valid = b.readBigUInt64LE(p + 8); p += 24;
  const rows = Array(64).fill(0);
  for (let i=0;i<64;i++) if (valid & (1n << BigInt(i))) { rows[i] = u32(p); p += 4; }
  const coded = {
    ResolutionScope:[2,[0,26,35,1]], TypeDefOrRef:[2,[2,1,27]], MemberRefParent:[3,[2,1,26,6,27]],
    HasConstant:[2,[4,8,23]], HasCustomAttribute:[5,[6,4,1,2,8,9,10,0,14,23,20,17,26,27,32,35,38,39,40,42,44,43]],
    CustomAttributeType:[3,[null,null,6,10,null]], HasFieldMarshal:[1,[4,8]], HasDeclSecurity:[2,[2,6,32]], HasSemantics:[1,[20,23]],
  };
  const schemas = [
    ['u2','s','g','g','g'], ['ResolutionScope','s','s'], ['u4','s','s','TypeDefOrRef',4,6], [4], ['u2','s','b'], [6],
    ['u4','u2','u2','s','b',8], [8], ['u2','u2','s'], [2,'TypeDefOrRef'], ['MemberRefParent','s','b'], ['u2','HasConstant','b'],
    ['HasCustomAttribute','CustomAttributeType','b'], ['HasFieldMarshal','b'], ['u2','HasDeclSecurity','b'], ['u2','u4',2], ['u4',4], ['b'],
    [2,20], [20], ['u2','s','TypeDefOrRef'], [2,23], [23], ['u2','s','b'], ['u2',6,'HasSemantics']
  ];
  const width = t => typeof t === 'number' ? (rows[t] >= 65536 ? 4 : 2) : sizes[t] || (t==='u2'?2:t==='u4'?4:Math.max(...coded[t][1].filter(x=>x!==null).map(i=>rows[i])) >= 2**(16-coded[t][0])?4:2);
  const tables = [];
  for (let i=0;i<schemas.length;i++) { const layout = schemas[i]; const entries=[]; for(let r=0;r<rows[i];r++) { const v=[]; for(const t of layout) { const w=width(t); v.push(w===4?u32(p):u16(p)); p+=w; } entries.push(v); } tables[i]=entries; }
  const typeName = (table, row) => { const e=tables[table][row-1]; return e ? [str(e[table===2?2:2]), str(e[1])].filter(Boolean).join('.') : null; };
  const tokenName = v => typeName([2,1,27][v&3],v>>>2);
  function compressed(state) { let v=b[state.p++]; if(v<128)return v; if(v<192)return ((v&63)<<8)|b[state.p++]; return ((v&31)<<24)|(b[state.p++]<<16)|(b[state.p++]<<8)|b[state.p++]; }
  function parseType(state) { const code=b[state.p++]; const simple={1:'void',2:'Boolean',3:'Char',4:'SByte',5:'Byte',6:'Int16',7:'UInt16',8:'Int32',9:'UInt32',10:'Int64',11:'UInt64',12:'Single',13:'Double',14:'String',28:'Object'}; if(simple[code])return simple[code]; if(code===17||code===18)return tokenName(compressed(state)); if(code===29)return {array:parseType(state)}; if(code===21) { const base=parseType(state), n=compressed(state), args=[]; for(let i=0;i<n;i++)args.push(parseType(state)); return {base,args}; } throw Error('Unsupported CLI signature '+code); }
  function signature(offset, property) { const state={p:blobs+offset}; compressed(state); state.p++; if(property)compressed(state); return parseType(state); }
  const result={};
  for (let i=0;i<tables[2].length;i++) { const e=tables[2][i], name=typeName(2,i+1), next=tables[2][i+1]; const fields=[];
    for(let j=e[4];j<(next?next[4]:rows[4]+1);j++) {const f=tables[4][j-1]; if((f[0]&7)===6 && !(f[0]&0x10))fields.push({name:str(f[1]),type:signature(f[2])});}
    const props=[]; const mapIndex=tables[21].findIndex(x=>x[0]===i+1); if(mapIndex>=0) {const map=tables[21][mapIndex], after=tables[21][mapIndex+1]; for(let j=map[1];j<(after?after[1]:rows[23]+1);j++) { const prop=tables[23][j-1]; const methods=tables[24].filter(x=>x[2]===(j*2+1)); if(methods.some(x=>(tables[6][x[1]-1][2]&7)===6)) props.push({name:str(prop[1]),type:signature(prop[2],true)}); }}
    result[name]={base:tokenName(e[3]),fields,properties:props};
  }
  return result;
};
