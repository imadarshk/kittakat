import type { PhotoUpload } from './types.ts';

export const MAX_DESCRIPTION_LENGTH=4000;
export const MAX_EXPENSE_PHOTOS=4;
export const MAX_PHOTO_BYTES=512*1024;
export const MAX_ENTRY_BODY_BYTES=3*1024*1024;

/** Validate bounded image bodies before they can enter the private database. */
export function validatePhotoUpload(input:Record<string,unknown>):PhotoUpload {
  if (typeof input.fileName!=='string' || !input.fileName.trim() || input.fileName.trim().length>180 || /[\u0000-\u001f\u007f/\\]/.test(input.fileName)) throw new Error('Photo filename must be 1–180 characters without paths or control characters.');
  if (input.mediaType!=='image/jpeg' && input.mediaType!=='image/png') throw new Error('Photos must be JPEG or PNG images.');
  const data=input.dataBase64;
  if (typeof data!=='string' || !data.length || data.length%4!==0 || data.length>Math.ceil(MAX_PHOTO_BYTES/3)*4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Photo must contain valid base64 and be at most 512 KiB.');
  const binary=atob(data),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if (bytes.length>MAX_PHOTO_BYTES || btoa(binary)!==data) throw new Error('Photo must contain valid base64 and be at most 512 KiB.');
  let width=0,height=0;
  if (input.mediaType==='image/png') {
    const signature=[137,80,78,71,13,10,26,10];
    if (bytes.length<45 || !signature.every((value,i)=>bytes[i]===value) || String.fromCharCode(...bytes.slice(12,16))!=='IHDR' || String.fromCharCode(...bytes.slice(-8,-4))!=='IEND') throw new Error('Photo content must match its PNG type.');
    const view=new DataView(bytes.buffer);
    if (view.getUint32(8)!==13) throw new Error('Invalid PNG image header.');
    width=view.getUint32(16); height=view.getUint32(20);
  } else {
    if (bytes[0]!==255 || bytes[1]!==216 || bytes[bytes.length-2]!==255 || bytes[bytes.length-1]!==217) throw new Error('Photo content must match its JPEG type.');
    let offset=2;
    while (offset<bytes.length-2) {
      if (bytes[offset++]!==255) throw new Error('Invalid JPEG image header.');
      while (bytes[offset]===255) offset++;
      const marker=bytes[offset++];
      if (marker===218 || marker===217) break;
      if (marker===1 || (marker>=208&&marker<=215)) continue;
      const length=(bytes[offset]<<8)|bytes[offset+1];
      if (length<2 || offset+length>bytes.length) throw new Error('Invalid JPEG image header.');
      if ([192,193,194].includes(marker) && length>=8) {
        height=(bytes[offset+3]<<8)|bytes[offset+4]; width=(bytes[offset+5]<<8)|bytes[offset+6];
      }
      offset+=length;
    }
  }
  if (width<1 || height<1 || width>4096 || height>4096 || width*height>16_000_000) throw new Error('Photo dimensions must be at most 4096 pixels per side and 16 megapixels.');
  return {fileName:input.fileName.trim(),mediaType:input.mediaType,dataBase64:data};
}

export function photoUrl(spaceId:string,entryId:string,photoId:string):string {
  return `/api/spaces/${encodeURIComponent(spaceId)}/entries/${encodeURIComponent(entryId)}/photos/${encodeURIComponent(photoId)}`;
}
