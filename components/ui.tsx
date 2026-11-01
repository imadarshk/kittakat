'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { X, ArrowUpRight, WalletCards } from 'lucide-react';
export function Brand({ compact = false }: { compact?: boolean }) { return <Link href="/" className="brand" aria-label="कित्ताकाट home"><span className="brand-mark" lang="ne">क</span>{!compact && <span lang="ne">कित्ताकाट<small>SHARED EXPENSES, CLEARLY.</small></span>}</Link>; }
export function Avatar({ name }: { name: string }) { return <span className="avatar" aria-hidden="true">{Array.from(name).slice(0, 2).join('').toUpperCase()}</span>; }
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <div className="empty"><span className="empty-icon"><WalletCards size={26} strokeWidth={1.3} /></span><h3>{title}</h3><p>{children}</p>{action}</div>; }
export function ErrorMessage({ error }: { error?: string }) { return error ? <p className="error" role="alert">{error}</p> : null; }
export function Money({ amount, small = false }: { amount: string; small?: boolean }) { return <span className={small ? 'money small-money' : 'money'}><small>NPR</small>{amount}</span>; }
export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
 const ref = useRef<HTMLDialogElement>(null);
 useEffect(() => { const node = ref.current; const previous = document.activeElement as HTMLElement | null; node?.showModal(); return () => { node?.close(); previous?.focus(); }; }, []);
 return <dialog ref={ref} className="modal" onCancel={close} onClick={e => { if (e.target === e.currentTarget) { const box=e.currentTarget.getBoundingClientRect(); if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom) close(); } }}><header><div><span className="eyebrow">कित्ताकाट / YOUR LEDGER</span><h2>{title}</h2></div><button type="button" className="icon-button" onClick={close} aria-label="Close dialog"><X size={20}/></button></header><div className="modal-body">{children}</div></dialog>;
}
export function SectionTitle({ eyebrow, title, text, action }: { eyebrow?: string; title: string; text?: string; action?: ReactNode }) { return <div className="section-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{text && <p>{text}</p>}</div>{action}</div>; }
export function Forward() { return <ArrowUpRight size={17} aria-hidden="true" />; }
export function localDate() { const date=new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
export type Mutate = (path: string, body: unknown, message?: string) => Promise<Record<string, unknown>>;
