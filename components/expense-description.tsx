'use client';
/* eslint-disable @next/next/no-img-element -- Private images require the viewer's session cookie and must render inline. */
import type { ExpensePayload, Member } from '../lib/types';
import { photoUrl } from '../lib/expense-photos';

export function ExpenseDescription({payload,spaceId,entryId,members}:{payload:ExpensePayload;spaceId:string;entryId:string;members:Member[]}) {
  const photos=payload.photos??[];
  if (!payload.description && !photos.length) return null;
  return <details className="expense-description" data-testid="expense-description">
    <summary>Description & photos{photos.length>0&&<span className="tag">{photos.length} {photos.length===1?'photo':'photos'}</span>}</summary>
    {payload.description&&<p className="description-text">{payload.description}</p>}
    {photos.length>0&&<div className="expense-photo-grid">{photos.map((photo,index)=><figure key={photo.id}>
      <a href={photoUrl(spaceId,entryId,photo.id)} target="_blank" rel="noopener noreferrer" aria-label={`Open photo ${index+1}: ${photo.fileName}`}><img src={photoUrl(spaceId,entryId,photo.id)} alt={`Photo ${index+1}: ${photo.fileName}`} loading="lazy"/></a>
      <figcaption><span>{photo.fileName}</span><small>Added by {members.find(member=>member.id===photo.uploadedById)?.displayName??'Space member'}</small></figcaption>
    </figure>)}</div>}
  </details>;
}
