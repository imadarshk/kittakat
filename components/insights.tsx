'use client';
import { useMemo, useState } from 'react';
import { ChartNoAxesColumn } from 'lucide-react';
import type { Bootstrap } from '../lib/types';
import { formatNpr, spendingInsights } from '../lib/domain';
import { localDate } from './ui';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthLabel = (key:string) => { const [year,month] = key.split('-').map(Number); return `${MONTHS[month-1]} ${String(year).slice(2)}`; };
const percent = (part:number,whole:number) => whole>0 ? Math.max(part>0?2:0,Math.round(part/whole*100)) : 0;

/** Where the money goes: category totals and a six-month trend, with the viewer's own share alongside. */
export function Insights({data}:{data:Bootstrap}) {
  const [scope,setScope] = useState<'space'|'you'>('space');
  const insights = useMemo(() => spendingInsights(data.entries,data.user!.id,localDate(),6),[data.entries,data.user]);
  if (!insights.expenseCount) return null;
  const value = (item:{totalCents:number;yourShareCents:number}) => scope==='space' ? item.totalCents : item.yourShareCents;
  const categoryMax = Math.max(...insights.categories.map(value),1);
  const monthMax = Math.max(...insights.months.map(value),1);
  const thisMonth = insights.months[insights.months.length-1], lastMonth = insights.months[insights.months.length-2];
  const change = lastMonth && value(lastMonth) ? Math.round((value(thisMonth)-value(lastMonth))/value(lastMonth)*100) : null;
  return <section className="panel insights" aria-labelledby="insights-title">
    <div className="panel-heading">
      <div><span className="eyebrow">WHERE IT GOES</span><h2 id="insights-title">Spending, at a glance.</h2></div>
      <div className="segmented compact" role="group" aria-label="Show totals for">
        <button type="button" aria-pressed={scope==='space'} onClick={()=>setScope('space')}>Whole space</button>
        <button type="button" aria-pressed={scope==='you'} onClick={()=>setScope('you')}>Your share</button>
      </div>
    </div>
    <div className="insight-summary">
      <div><span className="eyebrow">THIS MONTH</span><strong>{formatNpr(value(thisMonth))}</strong>
        <small>{change===null ? 'Nothing to compare with last month' : change===0 ? 'Same as last month' : `${Math.abs(change)}% ${change>0?'more':'less'} than last month`}</small></div>
      <div><span className="eyebrow">ALL TIME</span><strong>{formatNpr(scope==='space'?insights.totalCents:insights.yourShareCents)}</strong>
        <small>{insights.expenseCount} {insights.expenseCount===1?'expense':'expenses'} · cancelled entries excluded</small></div>
    </div>
    <div className="insight-columns">
      <div>
        <h3>By category</h3>
        <ul className="category-bars">
          {insights.categories.map(category => <li key={category.category}>
            <div className="bar-label"><span>{category.category}<small>{category.count} {category.count===1?'expense':'expenses'}</small></span><strong>{formatNpr(value(category))}</strong></div>
            <span className="bar-track" aria-hidden="true"><span className="bar-fill" style={{width:`${percent(value(category),categoryMax)}%`}}/></span>
          </li>)}
        </ul>
      </div>
      <div>
        <h3>Last six months</h3>
        <div className="month-chart" role="list">
          {insights.months.map(month => <div className="month" role="listitem" key={month.month} aria-label={`${monthLabel(month.month)}: ${formatNpr(value(month))}`} title={`${monthLabel(month.month)} · ${formatNpr(value(month))}`}>
            <span className="month-bar" aria-hidden="true"><span style={{height:`${percent(value(month),monthMax)}%`}}/></span>
            <small>{monthLabel(month.month)}</small>
          </div>)}
        </div>
      </div>
    </div>
    <p className="fine-print"><ChartNoAxesColumn size={12}/> Based on expense dates. Repayments move money between people, so they aren’t counted as spending.</p>
  </section>;
}
