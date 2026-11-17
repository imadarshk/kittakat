'use client';
import { useState, type FormEvent } from 'react';
import { Ban, RotateCcw } from 'lucide-react';
import type { Entry } from '../lib/types';
import { ErrorMessage, type Mutate } from './ui';

/** Creator-only: cancel a mistaken entry (it leaves balances but keeps its history) or bring it back. */
export function CancelEntry({entry,mutate}:{entry:Entry;mutate:Mutate}) {
  const cancelled = entry.payload.cancelled===true;
  const [open,setOpen] = useState(false),[reason,setReason] = useState(''),[busy,setBusy] = useState(false),[error,setError] = useState('');
  async function submit(event:FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await mutate(`/api/spaces/${entry.spaceId}/entries/${entry.id}/cancel`,{expectedRevision:entry.revision,cancelled:!cancelled,reason:reason.trim()},
        cancelled ? 'Entry restored. Balances include it again.' : 'Entry cancelled. It no longer counts toward balances.');
      setOpen(false); setReason('');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="cancel-entry">
    {!open && <button type="button" className={`button ${cancelled?'primary':'quiet-danger'}`} onClick={()=>setOpen(true)} data-testid="cancel-entry">
      {cancelled ? <><RotateCcw size={16}/>Restore this entry</> : <><Ban size={16}/>Cancel this entry</>}
    </button>}
    {open && <form onSubmit={submit}>
      <p className="fine-print">{cancelled
        ? 'Restoring brings the entry back into everyone’s balances and asks account holders involved to review it again.'
        : 'Cancelling removes the entry from balances and reports totals. Its full history stays visible, and account holders involved can review or dispute the cancellation.'}</p>
      <label className="field">{cancelled?'Why restore it?':'Why cancel it?'}
        <textarea value={reason} onChange={e=>setReason(e.target.value)} required maxLength={500} autoFocus placeholder={cancelled?'e.g. It wasn’t a duplicate after all.':'e.g. Added twice by mistake.'}/>
      </label>
      <ErrorMessage error={error}/>
      <div className="button-row">
        <button className={`button ${cancelled?'primary':'danger'}`} disabled={busy||!reason.trim()}>{busy?'Saving…':cancelled?'Restore & notify':'Cancel entry & notify'}</button>
        <button type="button" className="button" onClick={()=>{setOpen(false);setError('');}} disabled={busy}>Keep as is</button>
      </div>
    </form>}
  </div>;
}
