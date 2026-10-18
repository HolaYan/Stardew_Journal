'use strict';
const readMetadata = require('./dotnet-metadata.cjs');
module.exports = function installGameReaders(xnb, assembly) {
  const metadata = readMetadata(assembly);
  const readers = {};
  const primitive = {Boolean:'readByte',Int32:'readInt32',UInt32:'readUInt32',Single:'readSingle',Byte:'readByte'};
  // xnb.js 1.2.1's BufferReader.readDouble advances eight bytes but reads a
  // Float32. Keep the vendored library unchanged and correct that in our adapter.
  const readDouble = buffer => new DataView(buffer.read(8)).getFloat64(0,true);
  function reference(buffer, resolver) { const index=buffer.read7BitNumber(); if(!index)return null; const reader=resolver.readers[index-1]; if(!reader) throw Error('Unknown content reader '+index); return reader.read(buffer,resolver); }
  function readType(type, buffer, resolver) {
    if(type==='Double')return readDouble(buffer);
    if(primitive[type]) {const value=buffer[primitive[type]](); return type==='Boolean'?Boolean(value):value;}
    if(type==='StardewValley.Season'||metadata[type]?.base==='System.Enum')return buffer.readInt32();
    if(type?.base==='System.Nullable`1')return buffer.readByte()?readType(type.args[0],buffer,resolver):null;
    if(type==='Microsoft.Xna.Framework.Point')return {x:buffer.readInt32(),y:buffer.readInt32()};
    if(type==='Microsoft.Xna.Framework.Rectangle')return {x:buffer.readInt32(),y:buffer.readInt32(),width:buffer.readInt32(),height:buffer.readInt32()};
    if(type==='Microsoft.Xna.Framework.Vector2')return {x:buffer.readSingle(),y:buffer.readSingle()};
    if(type==='Microsoft.Xna.Framework.Color')return buffer.readUInt32();
    return reference(buffer,resolver);
  }
  let index=0;
  for(const [fullName,meta] of Object.entries({...metadata,'StardewValley.Season':{base:'System.Enum',fields:[],properties:[]}})) {
    const readerName='Installed'+index++; const isEnum=meta.base==='System.Enum';
    const cls=class extends xnb.Readers.BaseReader {
      static isTypeOf(type){return type===fullName;}
      static type(){return readerName;}
      isValueType(){return isEnum;}
      read(buffer,resolver) {
        if(isEnum)return buffer.readInt32();
        let out={};
        if(metadata[meta.base])out=new readers[metadata[meta.base].readerName+'Reader']().read(buffer,resolver);
        for(const field of [...meta.properties,...meta.fields]) {
          try {out[field.name]=readType(field.type,buffer,resolver);}
          catch(error){error.message=fullName+'.'+field.name+': '+error.message;throw error;}
        }
        return out;
      }
    };
    meta.readerName=readerName;
    readers[readerName+'Reader']=cls;
  }
  class PointReader extends xnb.Readers.BaseReader {
    static isTypeOf(type){return ['Microsoft.Xna.Framework.Point','Microsoft.Xna.Framework.Content.PointReader'].includes(type);}
    read(buffer){return {x:buffer.readInt32(),y:buffer.readInt32()};}
  }
  class ColorReader extends xnb.Readers.BaseReader {
    static isTypeOf(type){return ['Microsoft.Xna.Framework.Color','Microsoft.Xna.Framework.Content.ColorReader'].includes(type);}
    read(buffer){return buffer.readUInt32();}
  }
  readers.PointReader=PointReader; readers.ColorReader=ColorReader;
  class DoubleReader extends xnb.Readers.DoubleReader {
    read(buffer){return readDouble(buffer);}
  }
  readers.DoubleReader=DoubleReader;
  xnb.addReaders(readers);
  return metadata;
};
