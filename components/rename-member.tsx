'use client';
import { useState, type FormEvent } from 'react';
import type { Member } from '../lib/types';
import { ErrorMessage, type Mutate } from './ui';

/** Owner-only: fix the name of a person who has no account. */
export function RenameMember({spaceId,member,mutate}:{spaceId:string;member:Member;mutate:Mutate}) {
  const [editing,setEditing] = useState(false),[name,setName] = useState(member.displayName),[busy,setBusy] = useState(false),[error,setError] = useState('');
  async function submit(event:FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { await mutate(`/api/spaces/${spaceId}/members/${member.id}`,{displayName:name.trim()},'Name updated.'); setEditing(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!editing) return <button type="button" className="text-button rename-member" onClick={()=>{setName(member.displayName);setEditing(true);}}>Rename</button>;
  return <form className="rename-member-form" onSubmit={submit}>
    <label className="sr-only" htmlFor={`rename-${member.id}`}>New name for {member.displayName}</label>
    <input id={`rename-${member.id}`} value={name} onChange={e=>setName(e.target.value)} required maxLength={80} autoFocus/>
    <button className="button primary" disabled={busy||!name.trim()}>{busy?'Saving…':'Save'}</button>
    <button type="button" className="button" onClick={()=>setEditing(false)} disabled={busy}>Cancel</button>
    <ErrorMessage error={error}/>
  </form>;
}
