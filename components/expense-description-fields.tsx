'use client';
/* eslint-disable @next/next/no-img-element -- These are local previews and authenticated private image endpoints. */
import { useState, type ChangeEvent } from 'react';
import { ImagePlus, X } from 'lucide-react';
import type { ExpensePhoto, PhotoUpload } from '../lib/types';
import { MAX_DESCRIPTION_LENGTH, MAX_EXPENSE_PHOTOS, photoUrl } from '../lib/expense-photos';
import { prepareExpensePhoto } from '../lib/prepare-expense-photo';
import { ErrorMessage } from './ui';

export type PhotoDraft=ExpensePhoto|PhotoUpload;
type Props={description:string;onDescription:(value:string)=>void;photos:PhotoDraft[];onPhotos:(photos:PhotoDraft[])=>void;onPreparing:(value:boolean)=>void;disabled:boolean;spaceId:string;entryId?:string};
export function ExpenseDescriptionFields({description,onDescription,photos,onPhotos,onPreparing,disabled,spaceId,entryId}:Props) {
  const [preparing,setPreparing]=useState(false),[error,setError]=useState('');
  async function select(event:ChangeEvent<HTMLInputElement>) {
    const files=Array.from(event.target.files??[]); event.target.value=''; setError('');
    if (!files.length || preparing || disabled) return;
    if (photos.length+files.length>MAX_EXPENSE_PHOTOS) {setError('Attach at most four photos. Remove one before adding more.'); return;}
    setPreparing(true); onPreparing(true);
    try {
      const prepared:PhotoUpload[]=[];
      for (const file of files) {
        try { prepared.push(await prepareExpensePhoto(file)); }
        catch(error) { throw new Error(`Could not prepare ${file.name}: ${(error as Error).message}`); }
      }
      onPhotos([...photos,...prepared]);
    } catch(error) {setError((error as Error).message);}
    finally {setPreparing(false);onPreparing(false);}
  }
  return <fieldset className="expense-description-fields" disabled={disabled||preparing}>
    <legend>The details (optional)</legend>
    <label className="field">Description<textarea value={description} onChange={event=>onDescription(event.target.value)} maxLength={MAX_DESCRIPTION_LENGTH} rows={3} placeholder="Add a little context, a receipt note, or what was included."/></label>
    <label className="field photo-picker"><span><ImagePlus size={17}/>Photos</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={select} disabled={disabled||preparing||photos.length>=MAX_EXPENSE_PHOTOS}/></label>
    <p className="fine-print">Up to four photos. JPEG, PNG, or WebP, up to 20 MiB each. Photos are resized for your shared ledger and shown directly when someone opens the description.</p>
    {preparing&&<p role="status" className="muted">Preparing photos…</p>}
    <ErrorMessage error={error}/>
    {photos.length>0&&<div className="expense-photo-grid photo-previews">{photos.map((photo,index)=><figure key={'id' in photo?photo.id:index}>
      <img src={'dataBase64' in photo?`data:${photo.mediaType};base64,${photo.dataBase64}`:photoUrl(spaceId,entryId!,photo.id)} alt={`Preview: ${photo.fileName}`}/>
      <figcaption>{photo.fileName}<button type="button" className="icon-button" onClick={()=>onPhotos(photos.filter((_,i)=>i!==index))} aria-label={`Remove photo ${index+1}: ${photo.fileName}`}><X size={16}/></button></figcaption>
    </figure>)}</div>}
  </fieldset>;
}
