const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');
try{fs.readFileSync('.env','utf8').split('\n').forEach(l=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2]})}catch{}
const SECRET=process.env.SECRET||'change-me',PORT=process.env.PORT||3000;
let pool=null;
if(process.env.DATABASE_URL){const {Pool}=require('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==='1'?{rejectUnauthorized:false}:false});
 pool.query('create table if not exists store(k text primary key,v jsonb)').catch(e=>console.error('DB',e.message))}
const F='data/db.json';fs.mkdirSync('data',{recursive:true});
const get=async k=>{if(pool){const r=await pool.query('select v from store where k=$1',[k]);return r.rows[0]?.v}
 try{return JSON.parse(fs.readFileSync(F))[k]}catch{return undefined}};
const set=async(k,v)=>{if(pool)return pool.query('insert into store(k,v) values($1,$2) on conflict(k) do update set v=$2',[k,JSON.stringify(v)]);
 let d={};try{d=JSON.parse(fs.readFileSync(F))}catch{}d[k]=v;fs.writeFileSync(F,JSON.stringify(d))};
const sign=n=>n+'.'+crypto.createHmac('sha256',SECRET).update(n).digest('hex');
const who=req=>{const m=(req.headers.cookie||'').match(/tok=([^;]+)/);if(!m)return;const t=decodeURIComponent(m[1]),i=t.lastIndexOf('.');const n=t.slice(0,i);return sign(n)===t?n:undefined};
const hash=(p,s)=>crypto.scryptSync(p,s,32).toString('hex');
function unzip(buf,want){let e=buf.length-22;while(e>0&&buf.readUInt32LE(e)!==0x06054b50)e--;
 let p=buf.readUInt32LE(e+16);const n=buf.readUInt16LE(e+10);
 for(let i=0;i<n;i++){const m=buf.readUInt16LE(p+10),cs=buf.readUInt32LE(p+20),nl=buf.readUInt16LE(p+28),el=buf.readUInt16LE(p+30),cl=buf.readUInt16LE(p+32),lo=buf.readUInt32LE(p+42),name=buf.toString('utf8',p+46,p+46+nl);
  if(name===want){const s=lo+30+buf.readUInt16LE(lo+26)+buf.readUInt16LE(lo+28),d=buf.slice(s,s+cs);return(m?zlib.inflateRawSync(d):d).toString('utf8')}
  p+=46+nl+el+cl}}
const dec=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
function fromDocx(buf){const x=unzip(buf,'word/document.xml')||'';const out=[];
 for(const tr of x.split('<w:tr').slice(1)){const c=tr.split('<w:tc>').slice(1).map(t=>dec([...t.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m=>m[1]).join('')).trim());
  if(c.length>=3&&c[0])out.push({w:c[0],p:c[1],m:c[2],e:c[3]||''})}
 if(out.length&&/لغت|word/i.test(out[0].w))out.shift();return out}
async function fromPdf(buf){let t='';try{t=(await require('pdf-parse')(buf)).text}catch{throw Error('pdf-parse نصب نیست؛ فایل Word بدهید یا متن را paste کنید')}
 return fromText(t)}
function fromText(t){return t.split('\n').map(l=>l.split(/\||\t/).map(s=>s.trim())).filter(c=>c.length>=3&&c[0]).map(c=>({w:c[0],p:c[1],m:c[2],e:c[3]||''}))}
async function claude(system,messages,max=800){const key=process.env.ANTHROPIC_API_KEY;if(!key)throw Error('Set ANTHROPIC_API_KEY in .env to enable this feature');
 const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model:process.env.MODEL||'claude-sonnet-5-5',max_tokens:max,system,messages})});
 const j=await r.json();if(!j.content)throw Error(j.error?.message||'AI error');return j.content[0].text}
async function examples(text,kind,avoid){const t=await claude('You write accurate English teaching examples with correct, natural Persian translations.',[{role:'user',content:`Write 8 NEW, varied English example sentences (different subjects, verbs and situations; mix affirmative, negative and questions) for the ${kind==='word'?'phrase':'grammar topic'}: "${text}". Do NOT repeat or closely resemble these: ${JSON.stringify(avoid||[]).slice(0,1500)}. Each line exactly: English | Persian. No numbering, no extra text.`}],900);
 return t.split('\n').filter(x=>x.includes('|')).map(l=>{const[a,...b]=l.split('|');return[a.trim(),b.join('|').trim()]})}
const body=req=>new Promise(r=>{let b=[],n=0;req.on('data',c=>{n+=c.length;if(n<2e7)b.push(c)});req.on('end',()=>{try{r(JSON.parse(Buffer.concat(b)))}catch{r({})}})});
const T={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css','.json':'application/json'};
http.createServer(async(req,res)=>{const send=(c,o,h={})=>{res.writeHead(c,{'content-type':'application/json',...h});res.end(JSON.stringify(o))};
 try{const u=req.url.split('?')[0];
 if(u.startsWith('/api/')){const b=req.method==='POST'||req.method==='PUT'?await body(req):{};
  if(u==='/api/register'||u==='/api/login'){const n=String(b.name||'').trim().toLowerCase().slice(0,30),p=String(b.password||'');
   if(!n||p.length<4)return send(400,{error:'Name and password (4+ chars) required'});
   const us=(await get('users'))||{};
   if(u==='/api/register'){if(us[n])return send(400,{error:'This name is taken'});const s=crypto.randomBytes(8).toString('hex');us[n]={s,h:hash(p,s)};await set('users',us)}
   else if(!us[n]||us[n].h!==hash(p,us[n].s))return send(401,{error:'Wrong name or password'});
   return send(200,{ok:1,name:n},{'set-cookie':`tok=${encodeURIComponent(sign(n))};Path=/;Max-Age=31536000;HttpOnly;SameSite=Lax`})}
  const me=who(req);if(!me)return send(401,{error:'login'});
  if(u==='/api/state'&&req.method==='GET')return send(200,{name:me,...((await get('u:'+me))||{prog:{},words:[]})});
  if(u==='/api/state'&&req.method==='PUT'){await set('u:'+me,{prog:b.prog||{},words:b.words||[]});return send(200,{ok:1})}
  if(u==='/api/import'){try{const buf=Buffer.from(b.data||'','base64');const l=/\.pdf$/i.test(b.name)?await fromPdf(buf):/\.docx$/i.test(b.name)?fromDocx(buf):fromText(buf.toString('utf8'));return send(200,{words:l})}catch(e){return send(400,{error:e.message})}}
  try{
  if(u==='/api/example')return send(200,{examples:await examples(String(b.text).slice(0,200),b.kind,b.avoid)});
  if(u==='/api/translate')return send(200,{fa:await claude('Translate the text to natural, correct Persian. Output only the translation.',[{role:'user',content:String(b.text).slice(0,1500)}],600)});
  if(u==='/api/chat'){const topic=String(b.topic||'free talk').slice(0,200),m=(b.messages||[]).slice(-30);
   if(b.mode==='feedback'){const tr=m.map(x=>(x.role==='user'?'LEARNER: ':'PARTNER: ')+x.content).join('\n');
    return send(200,{text:await claude(`You are a kind, precise English teacher. A Persian-speaking learner practiced the topic "${topic}". Review ONLY the LEARNER's lines. For every mistake (grammar, word choice, tense, preposition, spelling, unnatural phrasing) write a block of exactly 3 lines:\n❌ <learner's sentence>\n✅ <corrected sentence>\n💡 <clear, complete explanation in simple English of WHY it is wrong and the rule>\nSeparate blocks with a blank line. If there are no mistakes, praise them. Finish with one line starting with ⭐ Tip:.`,[{role:'user',content:tr}],1500)})}
   return send(200,{text:await claude(`You are a friendly English conversation partner for a Persian-speaking learner (A2-B1). Topic: ${topic}. Reply in simple, natural English (1-3 short sentences) and end with ONE question. Do not correct mistakes now.`,m.length?m:[{role:'user',content:'Hi! Please start the conversation.'}],300)})}
  }catch(e){return send(400,{error:e.message})}
  if(u==='/api/logout')return send(200,{ok:1},{'set-cookie':'tok=;Path=/;Max-Age=0'});
  return send(404,{})}
 const f=path.join(__dirname,'public',u==='/'?'index.html':u.replace(/\.\./g,''));
 fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});res.end(d)})
 }catch(e){console.error(e);send(500,{error:'server'})}}).listen(PORT,()=>console.log('http://localhost:'+PORT));
