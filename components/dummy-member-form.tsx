'use client';
import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { ErrorMessage, type Mutate } from './ui';

export function DummyMemberForm({spaceId,mutate}:{spaceId:string;mutate:Mutate}) {
  const [name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await mutate(`/api/spaces/${spaceId}/members`,{displayName:name.trim()},'Person added. They’re ready to share expenses.');
      setName('');
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="dummy-member-form" data-testid="dummy-member-form">
    <h3>Add a person without an account</h3>
    <p className="muted">Include them in expenses, repayments, and balances. They won’t need to sign up or accept or dispute entries.</p>
    <label className="field">Person’s name<input name="displayName" value={name} onChange={event=>setName(event.target.value)} required maxLength={80} placeholder="What should we call them?" disabled={busy}/></label>
    <ErrorMessage error={error}/>
    <button type="submit" className="button primary" disabled={busy||!name.trim()}><Plus size={16}/>{busy?'Adding…':'Add person'}</button>
  </form>;
}
