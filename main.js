import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import { CATEGORIES, CATEGORY_LABELS, normalizedTags } from './matching.js';
import './style.css';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const db = url && key && !url.includes('YOUR_PROJECT') ? createClient(url, key) : null;
const app = document.querySelector('#app');
const S = { page:'home', user:null, profile:null, isAdmin:false, events:[], supplies:[], payments:[],
  bookings:[], profiles:[], stalls:[], adminBookings:[], allEvents:[], audit:[], opts:[],
  eventId:null, selectedStall:null, activeBookingId:null, adminTab:'dashboard', busy:false, pendingEmail:'',
  flash:'', flashType:'success' };
const e = (s) => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => '₱' + Number(n||0).toLocaleString('en-PH');
const dt = x => x ? new Date(x).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'}) : '—';
const cats = (value='') => CATEGORIES.map(([id,label])=>`<option value="${id}" ${value===id?'selected':''}>${e(label)}</option>`).join('');
const option = (id,value) => id===value?'selected':'';
const get = id=>document.getElementById(id);
const msg = (t,type='success')=>{S.flash=String(t);S.flashType=type;paintFlash();};
const paintFlash=()=>{const old=get('flash');if(old)old.remove(); if(!S.flash)return;
  const el=document.createElement('div');el.id='flash';el.className='alert'+(S.flashType==='error'?' error':'');el.role='status';el.textContent=S.flash;app.appendChild(el);};
const error = err => {console.error(err);msg(err?.message||String(err),'error');};
const requireDB = ()=>{if(!db)throw new Error('Supabase is not configured; see README.md');};
async function query(promise){const {data,error:err}=await promise;if(err)throw err;return data;}
function labels(code){return CATEGORY_LABELS[code]||code||'—';}
function stateLabel(s){return ({pending_payment:'Awaiting payment proof',pending_review:'Pending admin review',approved:'Approved',declined:'Declined / needs revision',cancelled:'Cancelled',expired:'Expired'})[s]||s;}
function badge(s){const tone=({approved:'ok',verified:'ok',compatible:'ok',open_solo:'ok',open_shared:'ok',pending_payment:'warn',pending_review:'warn',pending:'warn',review:'warn',declined:'danger',cancelled:'grey',rejected:'danger',full:'grey',held:'grey',blocked:'danger'})[s]||'grey';return `<span class="tag ${tone}">${e(stateLabel(s))}</span>`;}
function panel(title,body,extra=''){return `<div class="card"><h3>${title}</h3>${body}${extra}</div>`;}
function input(label,name,value='',type='text',extra=''){return `<label class="field">${label}<input name="${name}" type="${type}" value="${e(value)}" ${extra}></label>`;}
function navBtn(page,label){return `<button data-page="${page}" class="${S.page===page?'active':''}" type="button">${label}</button>`;}
function shell(content){const signed=!!S.user;const account=S.isAdmin?'Admin':(S.profile?.brand_name||'My Brand');
  app.innerHTML=`<header><div class="wrap nav"><div class="brand"><img src="/logo.svg" alt="Booth Buddy logo" width="42" height="42" style="vertical-align:middle;margin-right:6px;border-radius:10px">Booth Buddy<small>Pop-up Event Organizer</small></div>
  <nav aria-label="Main navigation" class="links">${navBtn('home','Home')}${navBtn('about','How it works')}${navBtn('events','Events')}${navBtn('supplies','Supplies')}${signed?navBtn('matcher','Booth Matcher')+navBtn('bookings','My Bookings')+navBtn('profile',e(account))+(S.isAdmin?navBtn('admin','Admin'):'')+`<button data-action="logout">Log out</button>`:`<button class="cta" data-page="auth">Sign in / Register</button>`}</nav></div></header>
  <main id="main">${content}</main><footer><div class="wrap"><b>Booth Buddy</b><p>Self-organized pop-up events • Solo or with a compatible Booth Buddy.</p><small>Sample venue and payment information is never represented as a real booking. Contact details, event dates, and payment instructions must be configured by your organizing team.</small></div></footer>`;
  paintFlash();
}
function guardMerchant(){if(!S.user){S.page='auth';return false;}if(!S.profile){S.page='profile';return false;}return true;}
async function sync(){requireDB(); const {data:{session},error:se}=await db.auth.getSession();if(se)throw se;
 let user=null;
 if(session){const {data,error:ue}=await db.auth.getUser();if(ue)throw ue;user=data.user;}
 S.user=user;
  S.profile=null;S.isAdmin=false;
  if(user){const [p,admins]=await Promise.all([query(db.from('merchant_profiles').select('*').eq('user_id',user.id).maybeSingle()),query(db.from('admin_users').select('user_id').eq('user_id',user.id).limit(1))]);S.profile=p;S.isAdmin=admins.length>0;}
  await refreshPublic(); if(user){await refreshBookings();if(S.isAdmin)await refreshAdmin();}
}
async function refreshPublic(){if(!db)return; const [events,supplies,methods]=await Promise.all([
  query(db.from('events').select('*').eq('published',true).neq('status','cancelled').order('starts_at')),
  query(db.from('supplies').select('*').eq('enabled',true).order('name')),
  S.user?query(db.from('payment_methods').select('*').eq('enabled',true).order('label')):Promise.resolve([])]);
  S.events=events;S.supplies=supplies;S.payments=methods;
}
async function refreshBookings(){S.bookings=S.user?await query(db.from('bookings').select('*').eq('merchant_id',S.user.id).order('created_at',{ascending:false})):[];}
async function refreshAdmin(){if(!S.isAdmin)return; const [profiles,bookings,events,stalls,supplies,methods,audit]=await Promise.all([
  query(db.from('merchant_profiles').select('*').order('updated_at',{ascending:false})),
  query(db.from('bookings').select('*').order('created_at',{ascending:false})),
  query(db.from('events').select('*').order('starts_at')),
  query(db.from('stalls').select('*').order('code')),
  query(db.from('supplies').select('*').order('name')),
  query(db.from('payment_methods').select('*').order('label')),
  query(db.from('audit_log').select('*').order('happened_at',{ascending:false}).limit(60))]);
  S.profiles=profiles;S.adminBookings=bookings;S.allEvents=events;S.stalls=stalls;S.adminSupplies=supplies;S.adminPayments=methods;S.audit=audit;
}
function eventCard(ev,admin=false){const past=new Date(ev.starts_at)<=new Date();return `<article class="card stack">
 ${ev.image_url?`<img class="cover" alt="${e(ev.title)}" src="${e(ev.image_url)}">`:`<div class="tile" style="font-size:50px;text-align:center">🏪</div>`}
 <div class="status-row">${badge(ev.status==='open'?'open_shared':ev.status)}<small class="muted">${dt(ev.starts_at)} — ${dt(ev.ends_at)}</small></div>
 <h3>${e(ev.title)}</h3><p class="sm">📍 ${e(ev.venue)}<br>${e(ev.description||'Curated local pop-up market')}</p>
 <div class="row"><div><small>Shared per merchant</small><div class="price">${money(ev.shared_price)}</div></div><div><small>Solo</small><div class="price">${money(ev.solo_price)}</div></div></div>
 ${admin?'':`<button class="button" ${past||ev.status!=='open'?'disabled':''} data-action="event" data-id="${e(ev.id)}">${past?'Event closed':'Select event & see stalls'}</button>`}
 </article>`;}
function home(){return `<section class="hero"><div class="wrap hero-grid"><div><div class="eyebrow">Metro Manila • Self-organized Pop-up Markets</div>
 <h1>Your brand deserves to <span style="color:#ff5733">pop up.</span> Together or solo.</h1><p class="lead">Get your own booth or share with a screened, complementary brand. Real booth availability, transparent event rates, and optional setup rentals—all in one place.</p>
 <div class="actions"><button class="button" data-page="events">Explore our events →</button><button class="button-secondary" data-page="about">How matching works</button></div></div>
 <div class="hero-panel"><span class="tag ok">Why share?</span><h2>Two small brands.<br>One shared stall.</h2><p>We use product declarations, complementary category rules, and organizer review—not invented match percentages—to help merchants find suitable neighbors.</p><div class="grid-2"><div class="tile"><b>🥤 Coffee brand</b><p class="sm">Coffee, cold brew, iced latte</p></div><div class="tile"><b>🥐 Bakery</b><p class="sm">Croissants, cookies, pastries</p></div></div><p class="caption">Illustrative combination only; not a live merchant match.</p></div></div></section>
 <section><div class="wrap"><h2>Why Booth Buddy?</h2><div class="features">${panel('🤝 Verified match candidates','<p>Only real, approved first occupants can appear as available shared-booth partners. Product conflicts are blocked or reviewed.</p>')}${panel('📍 We organize the venues','<p>Booth Buddy handles its own events, booking coordination, and on-site operations—not third-party organizer listings.</p>')}${panel('🧰 Optional setup support','<p>Rent tables, canopy tents, lights, and racks. Equipment choices are not preselected.</p>')}</div></div></section>
 <section><div class="wrap"><h2>Upcoming events</h2>${S.events.length?`<div class="grid">${S.events.slice(0,3).map(x=>eventCard(x)).join('')}</div>`:`<div class="card app-empty"><div><h3>Events are being prepared</h3><p>New events will appear after the Booth Buddy team confirms the venue, rates, and stall floorplan.</p></div></div>`}</div></section>`;}
function about(){return `<section><div class="wrap"><div class="section-head"><span class="eyebrow">A smarter way to pop up</span><h1>About Booth Buddy & How It Works</h1><p class="lead">Booth Buddy is a self-organized bazaar company offering Solo Booths and Shared Booths matched with non-competing small brands.</p></div>
 <div class="grid-2">${panel('Traditional bazaars','<p>Independent solo stall fees, informal booth-sharing arrangements, separate equipment suppliers, and uncertain compatibility.</p>')}${panel('With Booth Buddy','<p>Venue-specific transparent pricing, curated shared-booth candidates, optional equipment rentals, and admin-reviewed booking confirmations.</p>')}</div>
 <div class="spacer"></div><h2>Your merchant journey</h2><div class="grid-2">
 ${panel('1. Create your verified brand profile','<p>Register and verify your email, submit a business document or valid ID, list products and requirements. The organizing team reviews documents before final approval.</p>')}
 ${panel('2. Select an event and booth','<p>See actual physical stalls: Solo, Empty Shared, Compatible, Review Needed, Held or Full. Product conflicts and setup requirements are checked.</p>')}
 ${panel('3. Reserve and submit payment proof','<p>Choose optional supplies, review your server-calculated total, pay through an official configured payment account, and upload proof.</p>')}
 ${panel('4. Wait for approvals and buddy confirmation','<p>Organizer verifies both merchant eligibility and payment. Only two approved occupants form a confirmed shared match and unlock their partner contact details and gate pass.</p>')}
 </div><div class="spacer"></div>${panel('Solo vs Shared Booth',`<div class="tablewrap"><table><tr><th>Feature</th><th>Solo</th><th>Shared</th></tr><tr><td>Brands in physical stall</td><td>1</td><td>2 maximum</td></tr><tr><td>Space</td><td>Entire stall</td><td>Half each</td></tr><tr><td>Rates</td><td>Venue-specific solo rate</td><td>Venue-specific per-merchant shared rate</td></tr><tr><td>Matching</td><td>Not needed</td><td>Required before final confirmation</td></tr></table></div>`)}
 <div class="spacer"></div>${panel('Accepted merchant categories',`<p class="sm">${CATEGORIES.map(c=>e(c[1])).join(' • ')}</p><p class="caption">Different category labels don't automatically mean products are compatible; the team checks actual declarations.</p>`)}
 <div class="spacer"></div>${panel('Frequently asked questions',`<p><b>What if no buddy joins?</b> Contact the organizer before the event deadline for the available options under your booking agreement. Refunds, conversion to Solo, or transfer must be governed by published terms—not automatically promised.</p><p><b>Can I choose a buddy?</b> You can select a compatible approved first-occupant stall, or start an empty shared stall; the organizer reviews borderline matches.</p><p><b>Are my partner's contact details public?</b> No. They're revealed only when both shared-stall bookings are approved.</p><p><b>What does approved mean?</b> The team has reviewed the booking and payment. Shared-stall confirmation still needs a second approved merchant.</p>`)}
 </div></section>`;}
function events(){return `<section><div class="wrap"><div class="section-head"><span class="eyebrow">Find your next pop-up</span><h1>Upcoming Booth Buddy Events</h1><p>Published events show organizer-approved venue details and per-merchant booth rates. Prices vary by event.</p></div>${S.events.length?`<div class="grid">${S.events.map(v=>eventCard(v)).join('')}</div>`:'<div class="notice">No public events yet. An administrator must create and publish an event with actual stalls.</div>'}</div></section>`;}
function supplies(){return `<section><div class="wrap"><h1>Booth Supplies</h1><p>Optional rental equipment with current catalog pricing. Stock is allocated by overlapping event dates.</p><div class="grid">${S.supplies.map(s=>panel(e(s.name),`${s.image_url?`<img class="cover" src="${e(s.image_url)}" alt="${e(s.name)}">`:''}<p class="sm">${e(s.specs)}</p><div class="price">${money(s.price)}</div><small>Total fleet: ${e(s.total_stock)} units</small>`)).join('')||'<p>No supplies configured yet.</p>'}</div></div></section>`;}
function auth(){return `<section><div class="wrap"><div class="sheet"><h1>Merchant Account</h1><p>Sign in securely or register and confirm your email.</p><div class="grid-2">
 ${panel('Sign In',`<form class="form" data-form="signin">${input('Email','email','','email','required autocomplete="email"')}${input('Password','password','','password','required autocomplete="current-password"')}<button class="button" type="submit">Sign in</button></form>`)}
 ${panel('Register',`<form class="form" data-form="signup">${input('Email','email','','email','required autocomplete="email"')}${input('Password (8+ characters)','password','','password','required minlength="8" autocomplete="new-password"')}<button class="button-dark" type="submit">Create account</button></form>`)}
 </div><div class="spacer"></div>${panel('Forgot your password?',`<p class="sm">Request an official recovery link to your account email.</p><form class="form" data-form="recover">${input('Account email','email','','email','required')}<button class="button-secondary">Send password reset link</button></form>`)}<div class="spacer"></div>${panel('Email code confirmation',`<p class="sm">Your Supabase signup email template must use <code>{{ .Token }}</code> to send a numeric confirmation code. If your template still sends a link, click the link instead.</p><form class="form" data-form="verify"><div class="form-grid">${input('Registered email','email',S.pendingEmail,'email','required')}${input('Email code (6–8 digits)','token','','text','required pattern="[0-9]{6,8}" maxlength="8" inputmode="numeric"')}</div><button class="button-secondary" type="submit">Verify email code</button></form>`)}
 </div></div></section>`;}
function resetPassword(){return `<section><div class="wrap"><div class="sheet"><h1>Set a new password</h1><div class="card"><form class="form" data-form="reset">${input('New password (8+ characters)','password','','password','minlength="8" required autocomplete="new-password"')}<button class="button">Update password securely</button></form></div></div></div></section>`;}
function profile(){if(!S.user)return auth();const p=S.profile||{};return `<section><div class="wrap"><div class="sheet"><span class="eyebrow">Merchant registration</span><h1>My Brand Profile</h1><p>Finish this before booking. Product categories and requirements may be locked while you have active reservations.</p>
 <div class="notice ${p.verification_status==='rejected'?'error':'info'}">Identity status: <b>${e(p.verification_status||'Not submitted')}</b> ${p.verification_note?`• ${e(p.verification_note)}`:''}. Uploading a document does not mean the organizing team has verified it.</div><div class="spacer"></div>
 <div class="card"><form class="form" data-form="profile"><div class="form-grid">${input('Brand name','brand',p.brand_name,'text','required minlength="2" maxlength="100"')}${input('Owner name','owner',p.owner_name,'text','required minlength="2"')}${input('Phone number','phone',p.phone,'tel','required')}${input('Social media handle or URL','social',p.social)}</div>
 <label class="field">Primary product category<select name="category" required>${cats(p.category)}</select></label>
 <label class="field">Brand description<textarea name="bio" maxlength="1000">${e(p.bio)}</textarea></label>
 <label class="field">Product list and prices (what will you sell?)<textarea name="products" required minlength="5" placeholder="e.g. Iced oat latte ₱150; cold brew ₱160">${e(p.product_list)}</textarea></label>
 ${input('Product tags, separated by commas','tags',(p.product_tags||[]).join(', '),'text','required placeholder="e.g. iced latte, coffee, cold brew"')}
 <div class="form-grid"><label class="field">Space needed per merchant<select name="space_units"><option value="1" ${option('1',String(p.space_units||1))}>Standard half stall</option><option value="2" ${option('2',String(p.space_units||1))}>Full stall / larger setup</option></select></label><label class="field">Verification document type<select name="doc_type"><option ${option('Valid ID',p.doc_type)}>Valid ID</option><option ${option('DTI Certificate',p.doc_type)}>DTI Certificate</option><option ${option('BIR Form 2303',p.doc_type)}>BIR Form 2303</option></select></label></div>
 <div class="grid-2">${[['needs_power','Needs electricity'],['needs_water','Needs running water'],['uses_heat','Uses heating/cooking equipment'],['strong_scent','Strong fragrance or scent']].map(([k,label])=>`<label class="check"><input type="checkbox" name="${k}" ${p[k]?'checked':''}>${label}</label>`).join('')}</div>
 <label class="field">Upload verification document (PDF, JPG, PNG, WebP; max 10 MB)<input type="file" name="document" accept="application/pdf,image/png,image/jpeg,image/webp" ${p.doc_path?'':'required'}></label>${p.doc_path?`<div class="sm">Document saved. <button type="button" class="button-plain" data-action="view-private" data-bucket="merchant-docs" data-path="${e(p.doc_path)}">View my uploaded document</button></div>`:''}
 <label class="field">Optional brand promotional photos (max 5 MB each)<input type="file" name="promos" accept="image/jpeg,image/png,image/webp" multiple></label>
 <label class="check"><input type="checkbox" name="promo_consent" ${p.promo_consent?'checked':''}>I voluntarily allow Booth Buddy to use my promotional photos for event marketing. (Optional)</label>
 <button class="button" type="submit">Save brand profile</button></form></div></div></div></section>`;}
function selectedEvent(){return S.events.find(x=>x.id===S.eventId);}
function matcher(){if(!guardMerchant())return profile();const ev=selectedEvent();return `<section><div class="wrap"><span class="eyebrow">Booth Buddy's main innovation</span><h1>Live Booth Matcher</h1><p>The same physical stall is shown consistently to every merchant. Only actual approved occupants appear as potential partners; no invented profiles.</p>
 ${S.profile.verification_status!=='verified'?'<div class="notice info">Your profile is awaiting identity verification. You may request a booth; the organizer must approve your identity and payment before your brand becomes a match candidate.</div>':''}
 <div class="spacer"></div><label class="field">Choose an available event<select id="matcher-event"><option value="">Select an event</option>${S.events.filter(x=>x.status==='open'&&new Date(x.starts_at)>new Date()).map(x=>`<option value="${e(x.id)}" ${option(x.id,S.eventId)}>${e(x.title)} — ${dt(x.starts_at)}</option>`).join('')}</select></label>
 ${ev?`<div class="card" style="margin:20px 0"><h3>${e(ev.title)}</h3><p>📍 ${e(ev.venue)}<br>📅 ${dt(ev.starts_at)} to ${dt(ev.ends_at)}</p><p><b>Shared:</b> ${money(ev.shared_price)} per merchant • <b>Solo:</b> ${money(ev.solo_price)}</p></div>
 <h2>Available physical stalls</h2><div class="actions"><button class="button-secondary" data-action="refresh-matches">↻ Refresh live availability</button></div><p class="sm">Green = eligible candidate, gold = open shared stall or review needed. A match becomes confirmed only after BOTH merchants are approved.</p>
 <div class="grid">${S.opts.length?S.opts.map(o=>`<div class="card stall ${e(o.state)}"><div class="row"><h3>🛒 ${e(o.code)}</h3>${badge(o.state)}</div>
 <div class="sm"><b>${o.mode==='solo'?'Full Solo Booth':'Shared Booth • 2 halves'}</b></div>
 ${o.partner_brand?`<div class="tile"><b>Existing verified brand:</b><br>${e(o.partner_brand)}<br><span class="sm">${e(labels(o.partner_category))}</span><p class="sm">${e(o.partner_bio)}</p></div>`:''}
 <p class="sm">${e(o.reason|| (o.state==='open_shared'?'Be the first merchant waiting for a buddy.':o.state==='open_solo'?'Book the full stall.':''))}</p>
 ${['open_solo','open_shared','compatible','review'].includes(o.state)?`<button class="button ${o.state==='review'?'button-secondary':''}" data-action="choose-stall" data-id="${e(o.stall_id)}">${o.state==='review'?'Request an organizer-reviewed pairing':o.state==='compatible'?'Join this compatible merchant':o.state==='open_shared'?'Start a shared booth':'Reserve Solo booth'}</button>`:'<span class="caption">Not currently selectable</span>'}</div>`).join(''):`<div class="notice">No available stalls configured for this event. Contact the organizer.</div>`}</div>`:
 `<div class="notice">Choose an event to see its actual stalls.</div>`}
 </div></section>`;}
function checkout(){if(!guardMerchant())return profile();const ev=selectedEvent(),stall=S.opts.find(x=>x.stall_id===S.selectedStall);if(!ev||!stall)return matcher();
 const base=stall.mode==='solo'?ev.solo_price:ev.shared_price;
 return `<section><div class="wrap"><div class="sheet"><span class="eyebrow">Step 3 of 4</span><h1>Reserve your booth</h1><div class="card"><h3>${e(ev.title)} • ${e(stall.code)}</h3><p>📅 ${dt(ev.starts_at)}<br>📍 ${e(ev.venue)}</p><div class="status-row"><b>${stall.mode==='shared'?'Shared (per merchant)':'Solo'} booking fee</b><strong>${money(base)}</strong></div>${stall.state==='review'?'<div class="notice">This pairing is subject to manual category compatibility review and may be declined.</div>':''}
 <form class="form" data-form="reserve"><label class="field">Exact products and prices to sell at this event<textarea name="products" required minlength="5" maxlength="4000">${e(S.profile.product_list)}</textarea></label>
 <h3>Optional booth equipment</h3><p class="sm">Nothing is preselected. Final availability and totals are checked by the server when reserving.</p>
 ${S.supplies.length?S.supplies.map(s=>`<div class="tile row"><label class="check"><input type="checkbox" name="supply" data-id="${e(s.id)}" data-price="${e(s.price)}"><span><b>${e(s.name)}</b><br><small>${e(s.specs)}</small><br><small>${money(s.price)} per unit</small></span></label><label class="field">Qty<input style="width:75px" type="number" min="1" max="5" value="1" data-qty="${e(s.id)}"></label></div>`).join(''):'<p class="sm">No equipment currently available.</p>'}
 <hr><div class="status-row"><strong>Total estimated amount</strong><strong class="price" id="checkout-total">${money(base)}</strong></div>
 <div class="notice info"><b>Reservation lasts 30 minutes while awaiting payment proof.</b> Booking is not approved until the organizer verifies your merchant details and payment. The shared partner is not guaranteed until both bookings are approved.</div>
 <button class="button full-width" type="submit">Reserve this actual stall →</button></form></div></div></div></section>`;}
function payment(){if(!S.user)return auth();const b=S.bookings.find(x=>x.id===S.activeBookingId);if(!b)return bookings();if(b.status!=='pending_payment'||new Date(b.reservation_expires_at)<=new Date())return bookings();
return `<section><div class="wrap"><div class="sheet"><h1>Submit Payment Proof</h1><div class="card"><div class="status-row"><span>Reservation ID</span><code>${e(b.id)}</code></div><div class="status-row"><span>Amount due</span><b class="price">${money(b.total_amount)}</b></div><div class="notice">Held until ${dt(b.reservation_expires_at)}. Pay only to a verified Booth Buddy account shown below. Never pay to a placeholder or sample account. If no account is configured, contact the organizer.</div>
 <form class="form" data-form="pay"><label class="field">Official payment method<select name="method" required><option value="">Select payment method</option>${S.payments.map(m=>`<option value="${e(m.id)}">${e(m.label)}</option>`).join('')}</select></label>
 ${S.payments.map(m=>`<div class="tile" data-pay-info="${e(m.id)}" hidden><h3>${e(m.label)}</h3><p class="sm"><b>Account name:</b> ${e(m.payee)}<br><b>Instructions:</b> ${e(m.instructions)}</p>${m.qr_image_url?`<img width="220" alt="Official organizer-provided payment QR" src="${e(m.qr_image_url)}">`:''}</div>`).join('')}
 ${input('Transaction reference from your payment app','reference','','text','required minlength="4"')}
 <label class="field">Actual payment screenshot / receipt (PDF, PNG, JPG, WebP)<input type="file" name="proof" accept="application/pdf,image/png,image/jpeg,image/webp" required></label>
 <label class="check"><input type="checkbox" name="attest" required>I confirm I submitted the actual transaction proof and the amount matches my reservation.</label>
 <button class="button full-width" type="submit" ${S.payments.length?'':'disabled'}>Submit for organizer verification</button></form></div></div></div></section>`;}
function bookings(){if(!S.user)return auth();const evName=id=>S.events.find(x=>x.id===id)?.title||'Event';return `<section><div class="wrap"><h1>My Bookings</h1><p>Only your account's bookings appear here. A merchant approval is separate from completing the shared match.</p>
 ${S.bookings.length?`<div class="stack">${S.bookings.map(b=>`<div class="card"><div class="status-row"><div><h3>${e(evName(b.event_id))}</h3><small>${e(b.id)}</small></div>${badge(b.status)}</div><p class="sm">${e(b.mode==='solo'?'Solo Booth':'Shared Booth')} • Amount ${money(b.total_amount)} • ${dt(b.created_at)}</p>
 ${b.status==='approved'&&b.mode==='shared'?'<p class="notice info">Checking whether both merchants have been approved…</p>':''}
 ${b.status==='pending_payment'?(new Date(b.reservation_expires_at)>new Date()?`<div class="actions"><button class="button" data-action="pay-booking" data-id="${e(b.id)}">Upload payment proof</button><button class="button-secondary" data-action="cancel" data-id="${e(b.id)}">Cancel hold</button></div>`:'<div class="notice error">The 30-minute hold expired. Choose an available stall again; do not send payment for this expired reservation.</div>'):''}
 ${b.status==='pending_review'?`<div class="actions"><span class="notice info">Awaiting organizer document and payment review.</span><button class="button-secondary" data-action="cancel" data-id="${e(b.id)}">Request cancellation / release</button></div>`:''}
 ${b.status==='approved'?`<div class="actions"><button class="button-plain" data-action="booking-details" data-id="${e(b.id)}">View buddy and gate pass status</button></div>`:''}
 ${b.review_note?`<div class="notice">Organizer notes: ${e(b.review_note)}</div>`:''}
 ${b.payment_status==='refund_due'?'<div class="notice error">Payment or refund reconciliation may be required. Contact the organizer; this is not a confirmed refund.</div>':''}${b.payment_status==='refunded'?'<div class="notice success">Organizer marked this payment refunded. Confirm in your bank or wallet.</div>':''}
 </div>`).join('')}</div>`:`<div class="card app-empty"><div><h3>No bookings yet</h3><p>Explore an event, select a real physical stall, and submit your reservation.</p><button class="button" data-page="events">See events</button></div></div>`}</div></section>`;}
async function bookingDetails(id){const b=S.bookings.find(x=>x.id===id);if(!b||b.status!=='approved')return;
 const [buddy,pass]=await Promise.all([b.mode==='shared'?query(db.rpc('get_confirmed_buddy',{p_booking_id:id})):Promise.resolve([]),query(db.rpc('get_gate_pass',{p_booking_id:id}))]);
 const detail=buddy[0],gate=pass[0];const container=get('main');
 const qr=gate?await QRCode.toDataURL(`BBPASS:${gate.pass_id}`,{margin:2,width:190}):'';
 container.innerHTML=`<section><div class="wrap"><div class="sheet"><h1>Approved Booking Details</h1><div class="card"><h3>${e(b.mode==='solo'?'Solo Booth':'Shared Booth')}</h3>
 ${b.mode==='shared'?(detail?`<div class="notice success"><b>Both merchants approved — confirmed Booth Buddy!</b></div><div class="tile"><h3>${e(detail.brand_name)}</h3><p>${e(labels(detail.category))}<br>Owner: ${e(detail.owner_name)}<br>Social: ${e(detail.social||'Not shared')}<br>Products: ${e(detail.product_list)}</p></div>`:`<div class="notice">Your own application is approved, but no second merchant has received approval yet. Your buddy contact details and entry pass remain locked.</div>`):'<div class="notice success">Your Solo Booth is approved. No buddy is required.</div>'}
 ${gate?`<div class="tile" style="text-align:center"><h3>Official Event Check-in Pass</h3><img id="qr-pass" src="${qr}" alt="Booking check-in code"><p><b>${e(gate.brand_name)}</b><br>${e(gate.event_title)} • Stall ${e(gate.stall_code)}<br><small>Approved products: ${e(gate.products)}</small></p><p class="caption">Check-in only succeeds when an authorized organizer validates this pass against the database. Do not share publicly.</p><code>${e(gate.pass_id)}</code><div class="actions" style="justify-content:center"><button class="button-plain" data-action="copy" data-value="${e(gate.pass_id)}">Copy code</button></div></div>`:''}
 <button class="button-secondary" data-page="bookings">Back to bookings</button></div></div></div></section>`;}
function admin(){if(!S.isAdmin)return '<section><div class="wrap"><div class="notice error">Admin access is restricted.</div></div></section>';
 const tabs=[['dashboard','Overview'],['merchants','Merchant Verification'],['reservations','Bookings & Match Review'],['events','Events & Floorplan'],['supplies','Equipment'],['payments','Payment Accounts'],['checkin','Event Check-in'],['audit','Audit Log']];
 return `<section><div class="wrap"><span class="eyebrow">Organizer only</span><h1>Booth Buddy Admin</h1><div class="columns"><div class="adminmenu">${tabs.map(([id,name])=>`<button type="button" data-admin-tab="${id}" class="${S.adminTab===id?'active':''}">${name}</button>`).join('')}</div><div>${adminContent()}</div></div></div></section>`;}
function adminContent(){const t=S.adminTab;
 if(t==='dashboard')return `<div class="grid-2">${panel('Merchant applications',`<div class="price">${S.profiles.length}</div><small>${S.profiles.filter(p=>p.verification_status==='pending').length} awaiting verification</small>`)}${panel('Booking applications',`<div class="price">${S.adminBookings.length}</div><small>${S.adminBookings.filter(b=>b.status==='pending_review').length} awaiting review</small>`)}${panel('Verified collections',`<div class="price">${money(S.adminBookings.filter(b=>b.payment_status==='verified').reduce((s,b)=>s+b.total_amount,0))}</div><small>Approved payment records only; reconcile with actual bank/e-wallet ledger</small>`)}${panel('Shared awaiting buddy',`<div class="price">${S.adminBookings.filter(b=>b.mode==='shared'&&b.status==='approved'&&S.adminBookings.filter(x=>x.stall_id===b.stall_id&&x.status==='approved').length===1).length}</div><small>Approved first occupants needing a second approved merchant</small>`)}</div>`;
 if(t==='merchants')return `<h2>Merchant identity verification</h2><div class="stack">${S.profiles.map(p=>`<div class="card"><div class="status-row"><div><b>${e(p.brand_name)}</b><br><small>${e(p.owner_name)} • ${e(labels(p.category))}</small></div>${badge(p.verification_status)}</div><p class="sm">Products: ${e(p.product_list)}<br>Tags: ${e((p.product_tags||[]).join(', '))}<br>Document: ${e(p.doc_type)}</p><div class="actions">${p.doc_path?`<button class="button-secondary" data-action="view-private" data-bucket="merchant-docs" data-path="${e(p.doc_path)}">Inspect ID / registration document</button>`:''}${(p.promo_paths||[]).map((path,i)=>`<button class="button-secondary" data-action="view-private" data-bucket="promo-images" data-path="${e(path)}">View product photo ${i+1}</button>`).join('')}<button class="button-plain" data-action="merchant-approve" data-id="${e(p.user_id)}">Mark verified</button><button class="button-secondary" data-action="merchant-reject" data-id="${e(p.user_id)}">Reject</button></div>${p.verification_note?`<p class="caption">${e(p.verification_note)}</p>`:''}</div>`).join('')||'<div class="notice">No merchant profiles yet.</div>'}</div>`;
 if(t==='reservations')return `<h2>Bookings & matching decisions</h2><p class="sm">Verify official transaction activity before approving a proof. Never treat a screenshot as independently verified payment.</p><div class="stack">${S.adminBookings.map(b=>{const p=S.profiles.find(x=>x.user_id===b.merchant_id);const ev=S.allEvents.find(x=>x.id===b.event_id);const st=S.stalls.find(x=>x.id===b.stall_id);const pair=S.adminBookings.filter(x=>x.stall_id===b.stall_id&&x.id!==b.id&&['approved','pending_review','pending_payment'].includes(x.status));return `<div class="card"><div class="status-row"><div><b>${e(p?.brand_name||'Unknown merchant')}</b> • ${e(ev?.title||'Event')}<br><small>${e(st?.code||'Stall')} • ${e(b.mode)} • ${money(b.total_amount)}</small></div>${badge(b.status)}</div><p class="sm"><b>Declared products:</b> ${e(b.declared_products)}<br><b>Product tags:</b> ${e((b.product_tags_snapshot||[]).join(', '))}<br><b>Payment reported:</b> ${e(b.payment_reference||'Not submitted')} • ${e(b.payment_status)}</p>${pair.length?`<div class="tile"><b>Other booking(s) on this physical stall:</b>${pair.map(x=>`<p class="sm">${e(S.profiles.find(p=>p.user_id===x.merchant_id)?.brand_name||'Merchant')} • ${e(x.status)} • ${e(labels(x.category_snapshot))}<br><b>Products:</b> ${e(x.declared_products)}<br><b>Tags:</b> ${e((x.product_tags_snapshot||[]).join(', '))}</p>`).join('')}</div>`:''}${b.needs_match_review?'<div class="notice">Manual compatibility review required before approval. Inspect both product lists.</div>':''}
 <div class="actions">${b.proof_path?`<button class="button-secondary" data-action="view-private" data-bucket="payment-proofs" data-path="${e(b.proof_path)}">Inspect payment proof</button>`:''}${b.status==='pending_review'?`<button class="button-plain" data-action="booking-approve" data-id="${e(b.id)}">Approve after independent verification</button><button class="button-secondary" data-action="booking-decline" data-id="${e(b.id)}">Decline</button>`:''}${['approved','pending_payment','pending_review'].includes(b.status)?`<button class="button-secondary" data-action="booking-admin-cancel" data-id="${e(b.id)}">Cancel</button>`:''}${b.payment_status==='refund_due'?`<button class="button-plain" data-action="booking-refunded" data-id="${e(b.id)}">Mark actual refund completed</button>`:''}</div>${b.review_note?`<p class="caption">${e(b.review_note)}</p>`:''}</div>`;}).join('')||'<div class="notice">No bookings yet.</div>'}</div>`;
 if(t==='events')return `<h2>Events & physical stalls</h2>${panel('Create a real event',`<form class="form" data-form="new-event"><div class="form-grid">${input('Event title','title','','text','required')}${input('Venue address','venue','','text','required')}${input('Starts (Manila local)','starts','','datetime-local','required')}${input('Ends (Manila local)','ends','','datetime-local','required')}${input('Solo fee per merchant (PHP)','solo','','number','required min="0"')}${input('Shared fee PER merchant (PHP)','shared','','number','required min="0"')}</div>${input('Optional venue image URL','image','','url')}<label class="field">Description<textarea name="description"></textarea></label><div class="grid-2">${[['power','Electricity available'],['water','Water available'],['heat','Heating equipment allowed'],['scent','Strong fragrances allowed']].map(([id,txt])=>`<label class="check"><input type="checkbox" name="${id}" ${id==='power'||id==='scent'?'checked':''}>${txt}</label>`).join('')}</div><button class="button">Create unpublished event</button></form>`)}<div class="spacer"></div>
 ${S.allEvents.map(ev=>`<div class="card" style="margin-bottom:15px"><div class="status-row"><b>${e(ev.title)}</b>${badge(ev.published?'approved':'pending')}</div><p class="sm">${e(ev.venue)}<br>${dt(ev.starts_at)} — ${dt(ev.ends_at)}<br>Solo ${money(ev.solo_price)} • Shared ${money(ev.shared_price)}</p><div class="actions"><button class="button-secondary" data-action="edit-event" data-id="${e(ev.id)}">Edit event</button><button class="button-secondary" data-action="toggle-event" data-id="${e(ev.id)}" data-status="${ev.published?'off':'on'}">${ev.published?'Unpublish':'Publish'} event</button><button class="button-secondary" data-action="pause-event" data-id="${e(ev.id)}" data-status="${ev.status==='open'?'paused':'open'}">${ev.status==='open'?'Pause bookings':'Reopen bookings'}</button></div><hr>
 <h3>Physical stalls (${S.stalls.filter(s=>s.event_id===ev.id).length})</h3><div class="grid-2">${S.stalls.filter(s=>s.event_id===ev.id).map(st=>`<div class="tile"><b>${e(st.code)}</b> • ${e(st.mode)} • ${st.has_power?'Electricity':'No electricity'}<br><button class="button-plain" data-action="toggle-stall" data-id="${e(st.id)}">${st.enabled?'Disable':'Enable'} stall</button></div>`).join('')}</div>
 <form class="form" style="margin-top:16px" data-form="new-stall" data-event="${e(ev.id)}"><div class="form-grid">${input('Stall code','code','','text','required placeholder="A-01"')}<label class="field">Stall type<select name="mode"><option value="shared">Shared (two halves)</option><option value="solo">Solo (one merchant)</option></select></label></div><label class="check"><input type="checkbox" name="has_power">Has accessible electricity</label><button class="button-plain">Add physical stall</button></form></div>`).join('')}`;
 if(t==='supplies')return `<h2>Equipment inventory</h2>${panel('Add equipment',`<form class="form" data-form="new-supply"><div class="form-grid">${input('Name','name','','text','required')}${input('Price PHP','price','','number','required min="0"')}${input('Physical quantity','stock','','number','required min="0"')}${input('Photo URL (optional)','image','','url')}</div>${input('Equipment specifications','specs','','text','required')}<label class="check"><input type="checkbox" name="one_per_stall">At most one of this item per physical stall</label><button class="button">Add equipment</button></form>`)}<div class="spacer"></div><div class="stack">${S.adminSupplies.map(x=>`<div class="card"><b>${e(x.name)}</b><p class="sm">${e(x.specs)} • ${money(x.price)} • Fleet ${e(x.total_stock)}</p><div class="actions"><button class="button-secondary" data-action="edit-supply" data-id="${e(x.id)}">Edit price & stock</button><button class="button-plain" data-action="toggle-supply" data-id="${e(x.id)}">${x.enabled?'Disable':'Enable'}</button></div></div>`).join('')}</div>`;
 if(t==='payments')return `<h2>Official payment accounts</h2><div class="notice error">Enter your organization's verified account details only. Do not publish a generated text QR as a scannable official GCash/Maya/QR Ph payment code. QR image must come from your actual payment provider.</div><div class="spacer"></div>${panel('Add a payment method',`<form class="form" data-form="new-payment">${input('Method (GCash, Maya, bank, etc.)','label','','text','required')}${input('Official payee / account name','payee','','text','required')}${input('Transfer instructions and account number','instructions','','text','required')}${input('Official QR image URL (optional)','qr','','url')}<button class="button">Create DISABLED payment option</button></form>`)}<div class="spacer"></div><div class="stack">${S.adminPayments.map(m=>`<div class="card"><div class="row"><b>${e(m.label)}</b>${badge(m.enabled?'approved':'pending')}</div><p class="sm">Payee: ${e(m.payee)}<br>${e(m.instructions)}</p><button class="button-secondary" data-action="edit-payment" data-id="${e(m.id)}">Edit payment details</button> <button class="button-secondary" data-action="toggle-payment" data-id="${e(m.id)}">${m.enabled?'Disable':'Enable'} payment method</button></div>`).join('')}</div>`;
 if(t==='audit')return `<h2>Admin action audit</h2><div class="card tablewrap"><table><tr><th>When</th><th>Actor</th><th>Record</th><th>Status change</th><th>Note</th></tr>${S.audit.map(a=>`<tr><td>${dt(a.happened_at)}</td><td>${e(a.actor_user_id||'system')}</td><td>${e(a.entity_type)}<br><small>${e(a.entity_id)}</small></td><td>${e(a.old_status||'')} → ${e(a.new_status||'')}</td><td>${e(a.note||'')}</td></tr>`).join('')}</table></div>`;
 if(t==='checkin')return `<h2>Authenticated event check-in</h2>${panel('Validate a real approved pass',`<p class="sm">Scan the merchant's QR using a scanner that displays its <code>BBPASS:UUID</code> contents, or type/paste the UUID below. The server rejects invalid, unapproved, unmatched, or already-used passes.</p><form class="form" data-form="checkin">${input('Pass UUID (or BBPASS:UUID)','pass','','text','required')}<button class="button">Validate and check in</button></form>`)}<div class="notice info">This is a simple ingress validator, not the previously rejected penalty or tax-reporting module.</div>`;
 return '';
}
function render(){if(!db){app.innerHTML='<div class="wrap" style="padding:60px 20px"><h1>⛺ Booth Buddy</h1><div class="notice error">Missing Supabase configuration. Follow README.md: run schema.sql, create your admin, set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY on Vercel, then redeploy. No simulated real bookings are shown.</div></div>';return;}
 const html=({home,about,events,supplies,auth,profile,matcher,checkout,payment,bookings,admin,reset:resetPassword})[S.page]||home;
 shell(html());
 if(S.page==='checkout')calcTotal();
}
async function navigate(page){S.page=page;S.flash='';render();window.scrollTo({top:0,behavior:'smooth'});}
async function reload(){await sync();render();}
function calcTotal(){const ev=selectedEvent(),st=S.opts.find(x=>x.stall_id===S.selectedStall);if(!ev||!st)return;
 let total=st.mode==='solo'?ev.solo_price:ev.shared_price;
 for(const x of document.querySelectorAll('input[name=supply]:checked')){const n=document.querySelector(`input[data-qty="${x.dataset.id}"]`);total+=Number(x.dataset.price)*Math.max(1,Number(n?.value)||1);}
 if(get('checkout-total'))get('checkout-total').textContent=money(total);
}
async function loadOptions(){if(!S.user||!S.profile||!S.eventId)return;S.opts=await query(db.rpc('get_stall_options',{p_event_id:S.eventId}));}
async function uploadFile(bucket,file,path){
 const allowed=bucket==='promo-images'?['image/jpeg','image/png','image/webp']:['image/jpeg','image/png','image/webp','application/pdf'];
 const max=bucket==='promo-images'?5*1024*1024:10*1024*1024;
 if(!allowed.includes(file.type))throw new Error('Unsupported document format. Use PDF, PNG, JPG or WebP.');
 if(file.size<1||file.size>max)throw new Error(`File must be smaller than ${max/(1024*1024)} MB`);
 await query(db.storage.from(bucket).upload(path,file,{upsert:false,contentType:file.type}));return path;
}
function fileExtension(file){return ({'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[file.type]||'bin';}
const uuid=()=>crypto.randomUUID();
async function forms(form){const fd=new FormData(form);const type=form.dataset.form;
 if(type==='signup'){const email=String(fd.get('email')).trim().toLowerCase(),password=String(fd.get('password'));
  if(password.length<8)throw new Error('Use a password with at least 8 characters');
  const {data,error:err}=await db.auth.signUp({email,password,options:{emailRedirectTo:location.origin}});if(err)throw err;
  S.pendingEmail=email;msg('Check your email for a confirmation code or link.');render();return;}
 if(type==='verify'){const email=String(fd.get('email')).trim().toLowerCase();const token=String(fd.get('token')).trim();
  await query(db.auth.verifyOtp({email,token,type:'signup'}));await reload();await navigate('profile');msg('Email verified. Complete your brand profile.');return;}
 if(type==='recover'){const email=String(fd.get('email')).trim().toLowerCase();
  await query(db.auth.resetPasswordForEmail(email,{redirectTo:location.origin}));msg('If the email is registered, a password recovery email has been requested.');return;}
 if(type==='reset'){const password=String(fd.get('password'));if(password.length<8)throw new Error('Password too short');
  await query(db.auth.updateUser({password}));await reload();await navigate('profile');msg('Password changed.');return;}
 if(type==='signin'){await query(db.auth.signInWithPassword({email:String(fd.get('email')).trim().toLowerCase(),password:String(fd.get('password'))}));await reload();await navigate(S.isAdmin?'admin':S.profile?'events':'profile');msg('Signed in successfully.');return;}
 if(type==='profile'){
  const brand=String(fd.get('brand')||'').trim(),tags=normalizedTags(String(fd.get('tags')||'').split(','));
  if(!brand||!tags.length)throw new Error('Brand name and product tags are required');
  let docPath=S.profile?.doc_path||null;const document=fd.get('document');
  if(document instanceof File && document.size){docPath=`${S.user.id}/kyc/${uuid()}.${fileExtension(document)}`;await uploadFile('merchant-docs',document,docPath);}
  if(!docPath)throw new Error('Upload a business document or valid ID');
  const promos=Array.from(form.querySelector('input[name=promos]').files||[]);if(promos.length>6)throw new Error('Maximum 6 promotional photos per submission');
  const promoPaths=[...(S.profile?.promo_paths||[])];for(const f of promos){const p=`${S.user.id}/promo/${uuid()}.${fileExtension(f)}`;promoPaths.push(await uploadFile('promo-images',f,p));}
  const record={user_id:S.user.id,brand_name:brand,owner_name:String(fd.get('owner')).trim(),phone:String(fd.get('phone')).trim(),social:String(fd.get('social')).trim(),
   bio:String(fd.get('bio')).trim(),category:String(fd.get('category')),product_list:String(fd.get('products')).trim(),product_tags:tags,
   space_units:Number(fd.get('space_units')),needs_power:fd.has('needs_power'),needs_water:fd.has('needs_water'),uses_heat:fd.has('uses_heat'),strong_scent:fd.has('strong_scent'),
   doc_path:docPath,doc_type:String(fd.get('doc_type')),promo_paths:promoPaths,promo_consent:fd.has('promo_consent')};
  if(S.profile){const {user_id,...editable}=record;await query(db.from('merchant_profiles').update(editable).eq('user_id',S.user.id));}
  else await query(db.from('merchant_profiles').insert(record));
  await reload();await navigate('profile');msg('Profile saved. Organizer verification is separate from email confirmation.');return;}
 if(type==='reserve'){
  const supplies=Array.from(form.querySelectorAll('input[name=supply]:checked')).map(x=>({id:x.dataset.id,qty:Number(form.querySelector(`input[data-qty="${x.dataset.id}"]`)?.value||1)}));
  const id=await query(db.rpc('create_booking',{p_event_id:S.eventId,p_stall_id:S.selectedStall,p_products:String(fd.get('products')).trim(),p_supplies:supplies}));
  S.activeBookingId=id;await reload();await navigate('payment');msg('Stall reserved for 30 minutes. Upload actual payment proof to proceed.');return;}
 if(type==='pay'){
  const id=S.activeBookingId; if(!id)throw new Error('Select your reservation first');const f=fd.get('proof');if(!(f instanceof File)||!f.size)throw new Error('Upload payment proof');
  const path=`${S.user.id}/${id}/${uuid()}.${fileExtension(f)}`;
  await uploadFile('payment-proofs',f,path);
  await query(db.rpc('submit_payment',{p_booking_id:id,p_method_id:fd.get('method'),p_reference:String(fd.get('reference')).trim(),p_proof_path:path}));
  await refreshBookings();await navigate('bookings');msg('Proof submitted. Await independent organizer verification; this is NOT yet confirmed payment.');return;}
 if(!S.isAdmin)throw new Error('Admin authorization required');
 if(type==='new-event'){
  const starts=`${fd.get('starts')}:00+08:00`,ends=`${fd.get('ends')}:00+08:00`;
  if(!Number.isFinite(Date.parse(starts))||!Number.isFinite(Date.parse(ends)))throw new Error('Enter valid event date and time');
  await query(db.from('events').insert({title:String(fd.get('title')),venue:String(fd.get('venue')),description:String(fd.get('description')||''),image_url:String(fd.get('image')||''),
   starts_at:new Date(starts).toISOString(),ends_at:new Date(ends).toISOString(),solo_price:Number(fd.get('solo')),shared_price:Number(fd.get('shared')),
   power_available:fd.has('power'),water_available:fd.has('water'),heat_allowed:fd.has('heat'),scent_allowed:fd.has('scent'),published:false}));
  await reload();msg('Event created UNPUBLISHED. Add physical stalls before publishing.');return;}
 if(type==='new-stall'){
  await query(db.from('stalls').insert({event_id:form.dataset.event,code:String(fd.get('code')).trim().toUpperCase(),mode:String(fd.get('mode')),has_power:fd.has('has_power')}));
  await reload();msg('Stall saved. Its mode and capacity now apply to all merchants.');return;}
 if(type==='new-supply'){
  await query(db.from('supplies').insert({name:String(fd.get('name')),price:Number(fd.get('price')),total_stock:Number(fd.get('stock')),specs:String(fd.get('specs')),image_url:String(fd.get('image')||''),one_per_stall:fd.has('one_per_stall')}));
  await reload();msg('Equipment added.');return;}
 if(type==='new-payment'){
  await query(db.from('payment_methods').insert({label:String(fd.get('label')),payee:String(fd.get('payee')),instructions:String(fd.get('instructions')),qr_image_url:String(fd.get('qr')||''),enabled:false}));
  await reload();msg('Payment option saved DISABLED. Verify the payee and QR before enabling it.');return;}
 if(type==='checkin'){
  const id=String(fd.get('pass')).trim().replace(/^BBPASS:/i,'');
  await query(db.rpc('admin_check_in',{p_booking_id:id}));msg('Valid pass: check-in completed successfully.');return;}
}
async function act(btn){const action=btn.dataset.action,id=btn.dataset.id;
 if(action==='logout'){await query(db.auth.signOut());S.eventId=null;S.opts=[];await reload();await navigate('home');return;}
 if(action==='event'){S.eventId=id;if(!S.user){await navigate('auth');msg('Sign in and complete your merchant profile to view real stalls.');return;}
   if(!S.profile){await navigate('profile');msg('Complete your profile before matching.');return;}await loadOptions();await navigate('matcher');return;}
 if(action==='refresh-matches'){await refreshBookings();await loadOptions();render();msg('Availability refreshed from the shared database.');return;}
 if(action==='choose-stall'){S.selectedStall=id;await navigate('checkout');return;}
 if(action==='pay-booking'){S.activeBookingId=id;await refreshPublic();await navigate('payment');return;}
 if(action==='cancel'){
  if(!confirm('Cancel this reservation? Any reported payment requires organizer reconciliation.'))return;
  await query(db.rpc('cancel_my_booking',{p_booking_id:id}));await refreshBookings();render();msg('Reservation cancelled. Contact the team about any payment already sent.');return;}
 if(action==='booking-details'){await bookingDetails(id);return;}
 if(action==='copy'){await navigator.clipboard.writeText(btn.dataset.value||'');msg('Copied pass code.');return;}
 if(action==='view-private'){const bucket=btn.dataset.bucket,path=btn.dataset.path;
  if(!['merchant-docs','payment-proofs','promo-images'].includes(bucket))throw new Error('Invalid document bucket');
  const signed=await query(db.storage.from(bucket).createSignedUrl(path,60));
  window.open(signed.signedUrl,'_blank','noopener,noreferrer');return;}
 if(!S.isAdmin)throw new Error('Admin authorization required');
 if(action==='merchant-approve'||action==='merchant-reject'){
  const approval=action==='merchant-approve';const note=prompt(approval?'Confirm identity document is authentic and appropriate. Optional note:':'Reason for rejecting merchant:','');
  if(note===null)return;if(!approval&&!note.trim())throw new Error('Explain why identity verification was declined');
  if(approval&&!confirm('Did you personally inspect this merchant document?'))return;
  await query(db.rpc('review_merchant',{p_user_id:id,p_verify:approval,p_note:note}));await reload();msg('Merchant verification updated.');return;}
 if(action==='booking-approve'||action==='booking-decline'){
  const approval=action==='booking-approve';const b=S.adminBookings.find(x=>x.id===id);
  let override=false;
  if(approval){if(!confirm('IMPORTANT: Did you inspect the full product list AND independently verify the payment in the actual GCash/Maya/bank transaction record (not just the screenshot)?'))return;
   if(b?.needs_match_review){if(!confirm('Did you inspect both merchants’ declared product lists, shared setup requirements, and approve this non-standard category pairing?'))return;override=true;}}
  const note=prompt(approval?'Optional booking approval note:':'Explain why this booking is declined and what the merchant should do:','');if(note===null)return;
  if(!approval&&!note.trim())throw new Error('Please provide a rejection reason');
  await query(db.rpc('review_booking',{p_booking_id:id,p_approve:approval,p_note:note,p_override_manual:override}));await reload();msg('Booking review recorded. Verify refunds separately if necessary.');return;}
 if(action==='booking-admin-cancel'){
  const reason=prompt('Organizer cancellation reason (refund reconciliation may be necessary):','');if(reason===null||!reason.trim())return;
  await query(db.rpc('admin_cancel_booking',{p_booking_id:id,p_note:reason}));await reload();msg('Booking cancelled; review payment/refund obligations.');return;}
 if(action==='booking-refunded'){
  const reference=prompt('Enter the REAL completed refund transaction reference. Do not mark refunded until money has been returned:','');
  if(reference===null)return;if(reference.trim().length<4)throw new Error('Refund reference is required');
  if(!confirm('Have you independently confirmed the refund was actually sent?'))return;
  await query(db.rpc('admin_mark_refunded',{p_booking_id:id,p_reference:reference.trim()}));await reload();msg('Refund record updated.');return;}
 if(action==='edit-event'){
  const ev=S.allEvents.find(x=>x.id===id);if(!ev)return;
  const title=prompt('Event title:',ev.title);if(title===null)return;
  const venue=prompt('Venue/address:',ev.venue);if(venue===null)return;
  const description=prompt('Description:',ev.description);if(description===null)return;
  const solo=prompt('Solo price (PHP) — locked after reservations:',String(ev.solo_price));if(solo===null)return;
  const shared=prompt('Shared price PER merchant (PHP) — locked after reservations:',String(ev.shared_price));if(shared===null)return;
  if(!title.trim()||!venue.trim()||!/^\d+$/.test(solo)||!/^\d+$/.test(shared))throw new Error('Enter valid venue, title and prices');
  await query(db.from('events').update({title:title.trim(),venue:venue.trim(),description,solo_price:Number(solo),shared_price:Number(shared)}).eq('id',id));
  await reload();msg('Event details updated. Event dates can be set at creation; contact a developer for safe rescheduling with existing reservations.');return;}
 if(action==='toggle-stall'){
  const st=S.stalls.find(x=>x.id===id);if(!st)return;
  if(st.enabled&&!confirm('Disable this stall from future matching? Existing bookings are NOT cancelled.'))return;
  await query(db.from('stalls').update({enabled:!st.enabled}).eq('id',id));await reload();msg('Stall visibility updated.');return;}
 if(action==='edit-payment'){
  const m=S.adminPayments.find(x=>x.id===id);if(!m)return;
  const payee=prompt('Verified payee / account name:',m.payee);if(payee===null)return;
  const instructions=prompt('Account number and transfer instructions:',m.instructions);if(instructions===null)return;
  const qr=prompt('Provider-issued official QR image URL (optional):',m.qr_image_url);if(qr===null)return;
  if(!payee.trim()||!instructions.trim())throw new Error('Payee and account instructions are required');
  await query(db.from('payment_methods').update({payee:payee.trim(),instructions:instructions.trim(),qr_image_url:qr.trim(),enabled:false}).eq('id',id));
  await reload();msg('Payment details updated and DISABLED for re-verification.');return;}
 if(action==='toggle-event'){
  const ev=S.allEvents.find(x=>x.id===id);if(!ev)return;
  const publish=btn.dataset.status==='on';if(publish&&!S.stalls.some(x=>x.event_id===id))throw new Error('Add physical stalls before publishing');
  await query(db.from('events').update({published:publish}).eq('id',id));await reload();msg(publish?'Event published.':'Event unpublished.');return;}
 if(action==='pause-event'){
  await query(db.from('events').update({status:btn.dataset.status}).eq('id',id));await reload();msg('Event booking status updated.');return;}
 if(action==='toggle-supply'){
  const s=S.adminSupplies.find(x=>x.id===id);await query(db.from('supplies').update({enabled:!s.enabled}).eq('id',id));await reload();msg('Equipment status updated.');return;}
 if(action==='edit-supply'){
  const s=S.adminSupplies.find(x=>x.id===id);const name=prompt('Equipment name:',s.name);if(name===null)return;
  const specs=prompt('Equipment specifications:',s.specs);if(specs===null)return;
  const img=prompt('Equipment image URL (optional):',s.image_url);if(img===null)return;
  const price=prompt('New rental price (PHP):',String(s.price));if(price===null)return;
  const stock=prompt('Total owned/available physical quantity:',String(s.total_stock));if(stock===null)return;
  if(!/^\d+$/.test(price)||!/^\d+$/.test(stock))throw new Error('Price and stock must be non-negative whole numbers');
  await query(db.from('supplies').update({name:name.trim(),specs:specs.trim(),image_url:img.trim(),price:Number(price),total_stock:Number(stock)}).eq('id',id));await reload();msg('Equipment updated. Check existing future allocations if reducing stock.');return;}
 if(action==='toggle-payment'){
  const m=S.adminPayments.find(x=>x.id===id);if(!m.enabled&&!confirm('Confirm these are YOUR verified organization payment details and any QR is provider-issued. Enable this method?'))return;
  await query(db.from('payment_methods').update({enabled:!m.enabled}).eq('id',id));await reload();msg('Payment method updated.');return;}
}
app.addEventListener('click', async ev=>{
 const btn=ev.target.closest('[data-action],[data-page],[data-admin-tab]');if(!btn||S.busy)return;
 ev.preventDefault();S.busy=true;btn.disabled=true;
 try{if(btn.dataset.page){await navigate(btn.dataset.page);}
 else if(btn.dataset.adminTab){S.adminTab=btn.dataset.adminTab;render();}
 else await act(btn);
 }catch(err){error(err);}finally{S.busy=false;if(btn.isConnected)btn.disabled=false;}
});
app.addEventListener('submit',async ev=>{
 const form=ev.target.closest('form[data-form]');if(!form||S.busy)return;ev.preventDefault();S.busy=true;
 const btn=form.querySelector('button[type=submit],button:not([type])');if(btn)btn.disabled=true;
 try{await forms(form);}catch(err){error(err);}finally{S.busy=false;if(btn?.isConnected)btn.disabled=false;}
});
app.addEventListener('change',async ev=>{
 try{if(ev.target.id==='matcher-event'){
    S.eventId=ev.target.value;S.selectedStall=null;S.opts=[];if(S.eventId)await loadOptions();render();}
  if(ev.target.matches('input[name=supply],input[data-qty]'))calcTotal();
  if(ev.target.matches('select[name=method]'))document.querySelectorAll('[data-pay-info]').forEach(el=>el.hidden=el.dataset.payInfo!==ev.target.value);
 }catch(err){error(err);}
});
if(db)db.auth.onAuthStateChange(event=>{
  if(event==='PASSWORD_RECOVERY'){S.page='reset';render();}
});
(async()=>{try{if(!db){render();return;}await sync();render();}catch(err){error(err);render();}})();
