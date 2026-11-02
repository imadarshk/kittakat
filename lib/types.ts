export type SplitMethod = 'equal' | 'exact' | 'percent' | 'shares';
export type ReviewStatus = 'pending' | 'accepted' | 'disputed';
export interface User { id:string; username:string; displayName:string; authType:'password'|'chatgpt'|'dummy' }
export interface Space { id:string; name:string; ownerId:string; code:string; currency:'NPR'; createdAt:string }
export interface Member extends User { role:'owner'|'member'; joinedAt:string }
export interface PhotoUpload { fileName:string; mediaType:'image/jpeg'|'image/png'; dataBase64:string }
export interface ExpensePhoto { id:string; fileName:string; mediaType:PhotoUpload['mediaType']; uploadedById:string; createdAt:string }
export type ExpensePhotoInput = PhotoUpload | {id:string};
export interface ExpenseInput { kind:'expense'; title:string; description?:string; photos?:ExpensePhotoInput[]; amountCents:number; category:string; date:string; paidById:string; participantIds:string[]; splitMethod:SplitMethod; splitValues:Record<string,number> }
export interface ExpensePayload extends Omit<ExpenseInput,'photos'> { portions:Record<string,number>; photos?:ExpensePhoto[] }
export interface RepaymentInput { kind:'repayment'; title?:string; amountCents:number; date:string; fromId:string; toId:string }
export interface RepaymentPayload { kind:'repayment'; title:string; amountCents:number; date:string; fromId:string; toId:string }
export type EntryInput = ExpenseInput | RepaymentInput;
export type EntryPayload = ExpensePayload | RepaymentPayload;
export interface Revision { revision:number; payload:EntryPayload; reason:string; actorId:string; createdAt:string }
export interface Entry { id:string; spaceId:string; creatorId:string; revision:number; createdAt:string; payload:EntryPayload; history:Revision[] }
export interface Review { entryId:string; revision:number; userId:string; status:ReviewStatus; reason:string }
export interface Dispute { id:string; entryId:string; userId:string; openedRevision:number; reason:string; resolvedRevision:number|null }
export interface Notice { id:string; spaceId:string; entryId:string; revision:number; recipientId:string; actorId:string; type:'added'|'revised'|'disputed'|'resolved'; reason:string; createdAt:string; readAt:string|null }
export interface Bootstrap { user:User|null; chatgptEnabled:boolean; spaces:Space[]; activeSpace:Space|null; members:Member[]; entries:Entry[]; notices:Notice[]; reviews:Review[]; disputes:Dispute[] }
export interface Balance { userId:string; paidCents:number; shareCents:number; netCents:number }
export interface DebtItem { entryId:string; title:string; amountCents:number }
export interface PersonalDebt { userId:string; theyOweCents:number; youOweCents:number; netCents:number; items:DebtItem[] }
export type ExportKind='expenses'|'splits'|'repayments'|'balances'|'history';
export interface ExportData { space:Space; members:Member[]; entries:Entry[]; reviews:Review[]; disputes:Dispute[]; from?:string; to?:string }
export const CATEGORIES=['Food & dining','Groceries','Transport','Rent & stay','Utilities','Entertainment','Travel','Shopping','Health','Other'] as const;
