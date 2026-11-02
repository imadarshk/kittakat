import type { PhotoUpload } from './types';
import { MAX_PHOTO_BYTES } from './expense-photos';

/** Keep phone photos small and strip source metadata before submitting an expense. */
export async function prepareExpensePhoto(file:File):Promise<PhotoUpload> {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP photo.');
  if (!file.size || file.size>20*1024*1024) throw new Error('Choose a photo smaller than 20 MiB.');
  const image=await createImageBitmap(file);
  try {
    const scale=Math.min(1,1600/image.width,1600/image.height);
    let width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale));
    const canvas=document.createElement('canvas');
    for (let size=0;size<5;size++) {
      canvas.width=width; canvas.height=height;
      const context=canvas.getContext('2d');
      if (!context) throw new Error('Your browser could not prepare this photo.');
      context.fillStyle='#fff'; context.fillRect(0,0,width,height); context.drawImage(image,0,0,width,height);
      for (const quality of [0.85,0.7,0.55,0.4]) {
        const url=canvas.toDataURL('image/jpeg',quality);
        if (!url.startsWith('data:image/jpeg;base64,')) throw new Error('Your browser could not prepare this photo.');
        const dataBase64=url.slice(url.indexOf(',')+1);
        if (atob(dataBase64).length<=MAX_PHOTO_BYTES) {
          const name=file.name.replace(/\.[^.]+$/,'').replace(/[\u0000-\u001f\u007f/\\]/g,'_').trim().slice(0,170).toWellFormed()||'Photo';
          return {fileName:`${name}.jpg`,mediaType:'image/jpeg',dataBase64};
        }
      }
      width=Math.max(1,Math.round(width*0.75)); height=Math.max(1,Math.round(height*0.75));
    }
    throw new Error('This photo is too large. Choose a smaller image.');
  } finally { image.close(); }
}
