// Daily job: push each user a notification per task due today, plus one for overdue tasks.
// Runs from .github/workflows/notify.yml. The repo and its Action logs are public,
// so this script must never log task titles, lead names or subscription endpoints.
const admin=require('firebase-admin');
const webpush=require('web-push');

const VAPID_PUBLIC_KEY='BLBYGI3VXO-_kgb5UaNUjrR5eZdojuC55wMH4ZbUkfG6mv9OXGRvYned7WtrHIqSyl9wfxqprrMjvV46K9e6--w';
const SEND_HOUR=8; // Israel time
const MODE=process.env.MODE||'scheduled'; // scheduled | now | test

const il=(opts)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',...opts}).format(new Date());
const today=il({year:'numeric',month:'2-digit',day:'2-digit'}); // YYYY-MM-DD
const hour=parseInt(il({hour:'2-digit',hour12:false}),10)%24;

// One notification per task due today, plus a single reminder for everything overdue
function buildPayloads(tasks){
  if(MODE==='test')return[{title:'בדיקת התראות ✓',body:'אם את רואה את זה — ההתראות מהדשבורד עובדות',tag:'test'}];
  const open=tasks.filter(t=>!t.done&&t.due&&t.due.slice(0,10)<=today);
  const due=open.filter(t=>t.due.slice(0,10)===today);
  const late=open.filter(t=>t.due.slice(0,10)<today);
  const out=due.map(t=>({title:t.title,body:t.notes||'',tag:'task-'+t.id}));
  if(late.length){
    const lines=late.slice(0,4).map(t=>'• '+t.title);
    if(late.length>4)lines.push(`ועוד ${late.length-4}...`);
    out.push({title:`⚠️ ${late.length} משימות באיחור`,body:lines.join('
'),tag:'late-'+today});
  }
  return out;
}

async function main(){
  // Cron fires at two UTC hours to cover summer/winter time; only one of them is 08:00 in Israel
  if(MODE==='scheduled'&&hour!==SEND_HOUR){console.log(`Israel hour is ${hour}, not ${SEND_HOUR} — skipping`);return;}

  admin.initializeApp({credential:admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))});
  webpush.setVapidDetails('https://linoyh1-star.github.io/dashboard/',VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  const db=admin.firestore();

  let sent=0,failed=0,removed=0;
  const users=await db.collection('users').listDocuments();
  for(const u of users){
    const pushRef=u.collection('data').doc('push');
    const [pushSnap,tasksSnap]=await Promise.all([pushRef.get(),u.collection('data').doc('tasks').get()]);
    const subs=(pushSnap.exists&&pushSnap.data().value)||[];
    if(!subs.length)continue;
    const payloads=buildPayloads((tasksSnap.exists&&tasksSnap.data().value)||[]);
    if(!payloads.length)continue;

    const dead=new Set();
    for(const sub of subs){
      for(const payload of payloads){
        if(dead.has(sub.endpoint))break;
        try{
          await webpush.sendNotification(sub,JSON.stringify(payload));
          sent++;
        }catch(err){
          // 404/410 = the device unsubscribed; drop it so we stop trying
          if(err.statusCode===404||err.statusCode===410)dead.add(sub.endpoint);
          else{failed++;console.error('Push failed with status',err.statusCode||'unknown');}
        }
      }
    }
    if(dead.size){
      removed+=dead.size;
      await pushRef.set({value:subs.filter(s=>!dead.has(s.endpoint)),updatedAt:admin.firestore.FieldValue.serverTimestamp()});
    }
  }
  console.log(`Done (${MODE}): sent ${sent}, failed ${failed}, removed ${removed} expired devices`);
  if(failed&&!sent)process.exit(1);
}

main().catch(err=>{console.error('Notify job failed:',err.message);process.exit(1)});
