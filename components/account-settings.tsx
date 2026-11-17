'use client';
import { useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, Monitor, Moon, PencilLine, Sun } from 'lucide-react';
import type { Bootstrap } from '../lib/types';
import { applyTheme, readTheme, type ThemePreference } from '../lib/theme';
import { ErrorMessage, type Mutate } from './ui';

function useAction() {
  const [busy,setBusy] = useState(false),[error,setError] = useState('');
  async function run(task:()=>Promise<unknown>) {
    if (busy) return false;
    setBusy(true); setError('');
    try { await task(); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }
  return {busy,error,run};
}

function InlineEdit({label,value,maxLength,save,children}:{label:string;value:string;maxLength:number;save:(value:string)=>Promise<unknown>;children?:ReactNode}) {
  const [editing,setEditing] = useState(false),[draft,setDraft] = useState(value);
  const {busy,error,run} = useAction();
  async function submit(event:FormEvent) {
    event.preventDefault();
    if (draft.trim()===value) { setEditing(false); return; }
    if (await run(()=>save(draft.trim()))) setEditing(false);
  }
  if (!editing) return <div className="inline-edit"><div><span className="eyebrow">{label.toUpperCase()}</span><strong>{value}</strong>{children}</div>
    <button type="button" className="button" onClick={()=>{setDraft(value);setEditing(true);}}><PencilLine size={15}/>Edit</button></div>;
  return <form className="inline-edit editing" onSubmit={submit}>
    <label className="field">{label}<input value={draft} onChange={e=>setDraft(e.target.value)} required maxLength={maxLength} autoFocus/></label>
    <ErrorMessage error={error}/>
    <div className="button-row"><button className="button primary" disabled={busy||!draft.trim()}>{busy?'Saving…':'Save'}</button><button type="button" className="button" onClick={()=>setEditing(false)} disabled={busy}>Cancel</button></div>
  </form>;
}

function PasswordForm({mutate}:{mutate:Mutate}) {
  const [open,setOpen] = useState(false);
  const {busy,error,run} = useAction();
  const [mismatch,setMismatch] = useState('');
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('newPassword')!==form.get('confirmPassword')) { setMismatch('The new passwords don’t match.'); return; }
    setMismatch('');
    const target = event.currentTarget;
    if (await run(()=>mutate('/api/auth/password',{currentPassword:form.get('currentPassword'),newPassword:form.get('newPassword')},'Password changed. Other devices have been signed out.'))) { target.reset(); setOpen(false); }
  }
  if (!open) return <button type="button" className="setting-row" onClick={()=>setOpen(true)}><span><KeyRound size={19}/>Change password</span></button>;
  return <form className="password-form" onSubmit={submit}>
    <label className="field">Current password<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128}/></label>
    <label className="field">New password<input name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} placeholder="At least 8 characters"/></label>
    <label className="field">Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128}/></label>
    <ErrorMessage error={mismatch||error}/>
    <p className="fine-print">Changing your password signs you out everywhere else.</p>
    <div className="button-row"><button className="button primary" disabled={busy}>{busy?'Saving…':'Change password'}</button><button type="button" className="button" onClick={()=>setOpen(false)} disabled={busy}>Cancel</button></div>
  </form>;
}

export function ThemePicker() {
  const [theme,setTheme] = useState<ThemePreference>(()=>typeof window==='undefined'?'system':readTheme());
  const choose = (value:ThemePreference) => { setTheme(value); applyTheme(value); };
  const options:[ThemePreference,string,typeof Sun][] = [['system','Automatic',Monitor],['light','Light',Sun],['dark','Dark',Moon]];
  return <div className="theme-picker"><span className="eyebrow">APPEARANCE</span>
    <div className="segmented" role="group" aria-label="Appearance">
      {options.map(([value,label,Icon])=><button key={value} type="button" aria-pressed={theme===value} onClick={()=>choose(value)}><Icon size={15}/>{label}</button>)}
    </div></div>;
}

/** Your name and password, plus the owner's space name. */
export function AccountSettings({data,mutate}:{data:Bootstrap;mutate:Mutate}) {
  const user = data.user!, space = data.activeSpace;
  return <section className="panel account-panel">
    <h2>About you.</h2>
    <p className="muted">How your people see you, and how you sign in.</p>
    <InlineEdit label="Your name" value={user.displayName} maxLength={80} save={displayName=>mutate('/api/auth/profile',{displayName},'Your name was updated.')}>
      <small className="muted">{user.authType==='chatgpt'?'Signed in with ChatGPT':`@${user.username}`}</small>
    </InlineEdit>
    {space && space.ownerId===user.id && <InlineEdit label="Space name" value={space.name} maxLength={80} save={name=>mutate(`/api/spaces/${space.id}/name`,{name},'Space renamed.')}>
      <small className="muted">Only you, the owner, can rename it.</small>
    </InlineEdit>}
    {user.authType==='password' && <PasswordForm mutate={mutate}/>}
  </section>;
}
